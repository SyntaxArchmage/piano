import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { asRecord, nonEmptyString, numberValue, type JsonRecord } from "./json-narrowing.js";
import { dshRecordKey, type DshEventMapper } from "./dshSessionEvents.js";

/**
 * Reading the conversation dsh persisted, rather than inferring one.
 *
 * dsh keeps each session as a JSONL artifact under its own home, one file per
 * session, and Piano's adapter reads it back for two reasons: an interrupted
 * turn has no stdout result but still has a conversation, and a continued
 * actor must find *its own* session rather than a sibling's. Both lookups are
 * by session id — the id names the file — because a lookup by working
 * directory cannot tell two lanes apart once a map slot embeds its iteration
 * and slot number in the path.
 *
 * The artifact is being appended to while it is read, and compressed as one
 * zstd frame per batch, so everything here is incremental: a frame cursor, a
 * partial-line buffer, and a "the file shrank, so it was rewritten" reset.
 */

export interface DshSessionEvidence {
  readonly path: string;
  readonly sessionId: string;
  readonly text: string;
  readonly events: readonly JsonRecord[];
}

export interface DshSessionTailer {
  finish(): Promise<DshSessionEvidence | undefined>;
}

const ZSTD_MAGIC = 0xFD2FB528;

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** Locate complete zstd frames in dsh's concatenated-frame JSONL artifact. The
 * official persistence backend writes one header frame followed by one frame
 * per event batch; zstdDecompressSync alone would silently decode only the
 * first header frame. */
function dshZstdFrames(buffer: Buffer): readonly ByteRange[] {
  const frames: ByteRange[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 5 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return frames;
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) return frames;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryBytes = [0, 1, 2, 4][descriptor & 0x03] ?? 0;
    const contentSizeBytes = contentSizeFlag === 0
      ? singleSegment ? 1 : 0
      : 1 << contentSizeFlag;
    const frameHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < frameHeaderBytes) return frames;
    offset += frameHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return frames;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const blockType = (blockHeader >>> 1) & 0x03;
      if (blockType === 3) return frames;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return frames;
      offset += payloadBytes;
      if ((blockHeader & 0x01) !== 0) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

/** The directory dsh derives from a cwd to hold that project's sessions. Exported
 * because placing a session where this code looks is the only way to test the
 * lookups, and a test that re-implements the shape can silently drift from it. */
export function dshProjectKey(cwd: string): string {
  let readable = "";
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character === "/" || character === "\\" || character === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (character !== "~" && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

/** dsh's session artifact name by shape: `session.jsonl`, optionally carrying
 * dsh's own format version (`session.v3.jsonl.zstd` — what it writes today),
 * optionally compressed. Matched by shape rather than enumerated because the
 * name is dsh's to change: the literal list this replaced stopped matching the
 * moment the version segment appeared, and every dsh transcript silently
 * degraded to raw stdout. Both lookups below share this rule. */
const DSH_SESSION_ARTIFACT = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/;

/** Ordering for the case where one session directory holds more than one
 * artifact: newest format version first, compressed before plain, so the file
 * dsh is currently appending to wins. Unmatched names rank -1. */
function dshSessionArtifactRank(name: string): number {
  const match = DSH_SESSION_ARTIFACT.exec(name);
  if (match === null) return -1;
  return Number(match[1] ?? 0) * 2 + (name.endsWith(".zstd") ? 1 : 0);
}

/** The session artifacts among `names`, most preferred first. */
function dshSessionArtifacts(names: readonly string[]): readonly string[] {
  return names
    .filter((name) => dshSessionArtifactRank(name) >= 0)
    .sort((left, right) => dshSessionArtifactRank(right) - dshSessionArtifactRank(left));
}

/** The names dsh may have given the artifacts inside one session directory;
 * `undefined` when the directory cannot be read (no such session here). */
async function dshSessionArtifactNames(sessionDir: string): Promise<readonly string[] | undefined> {
  try {
    const entries = await readdir(sessionDir, { withFileTypes: true });
    return dshSessionArtifacts(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  } catch {
    return undefined;
  }
}

/** The session artifact for a known native session id, or undefined when this
 * object's storage does not hold it.
 *
 * dsh lays sessions out as
 * `<home>/sessions/<project-key>/<session-id>/<artifact>`, where `<artifact>`
 * matches {@link DSH_SESSION_ARTIFACT}; the session id names its own directory
 * and locates the file by itself — whatever project created it, and wherever
 * the actor's cwd has moved since.
 *
 * Independence from the cwd is what a continued map lane needs: its cwd embeds
 * the loop iteration and the slot (`.../slots/<iter>/<map>/slot-N`), so the
 * project directory holding the session is never the one the current epoch
 * names. It is also what keeps lanes apart, which is the property the cwd
 * cannot give: one project directory holds *every stage of one slot*, so a
 * lookup by cwd — or by "newest in this directory" — can hand an actor a
 * sibling's conversation. A session id belongs to exactly one actor, so a
 * lookup by id can only ever return that actor's own memory. */
async function sessionArtifactForId(home: string, sessionId: string): Promise<string | undefined> {
  const sessionsRoot = join(home, "sessions");
  let projects: readonly string[];
  try {
    projects = (await readdir(sessionsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  for (const project of projects) {
    const sessionDir = join(sessionsRoot, project, sessionId);
    const names = await dshSessionArtifactNames(sessionDir);
    // An unreadable directory means this project key does not hold the session;
    // keep looking, exactly as a failed stat on a named candidate did.
    if (names === undefined) continue;
    if (names.length > 0) return join(sessionDir, names[0] ?? "");
  }
  return undefined;
}

async function sessionArtifactPaths(home: string, cwd: string): Promise<readonly string[]> {
  const sessionsRoot = join(home, "sessions");
  const expectedProject = join(sessionsRoot, dshProjectKey(cwd));
  const projects: string[] = [];
  try {
    await stat(expectedProject);
    projects.push(expectedProject);
  } catch {
    // The fallback scan below handles older dsh layouts and lossy project-key
    // collisions without assuming a native implementation detail forever.
  }
  if (projects.length === 0) {
    try {
      for (const entry of await readdir(sessionsRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) projects.push(join(sessionsRoot, entry.name));
      }
    } catch {
      return [];
    }
  }
  const paths: string[] = [];
  for (const project of projects) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(project, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionDir = join(project, entry.name);
      // A concurrent dsh cleanup can remove an incomplete session, which reads
      // here as an unreadable directory.
      const names = await dshSessionArtifactNames(sessionDir);
      if (names === undefined) continue;
      for (const filename of names) paths.push(join(sessionDir, filename));
    }
  }
  return paths;
}

/** Decode just the first session header. The header is its own zstd frame, so
 * discovery never needs to inflate an entire growing transcript. */
function dshSessionHeader(path: string, raw: Buffer): JsonRecord | undefined {
  let headerBytes = raw;
  if (path.endsWith(".zstd")) {
    const first = dshZstdFrames(raw)[0];
    if (first === undefined) return undefined;
    try {
      headerBytes = zstdDecompressSync(raw.subarray(first.start, first.end));
    } catch {
      return undefined;
    }
  }
  const newline = headerBytes.indexOf(0x0a);
  if (newline < 0) return undefined;
  try {
    return asRecord(JSON.parse(headerBytes.subarray(0, newline).toString("utf8")));
  } catch {
    return undefined;
  }
}

/** dsh's JSONL writer packs runs of three or more delta chunks into a storage
 * row. The installed dsh reader expands these rows before exposing
 * `Session.events`; Piano must do the same at the process boundary so a packed
 * row remains a live text stream rather than an opaque unknown event. */
function expandDshStorageRecord(record: JsonRecord): readonly JsonRecord[] {
  if (record.type !== "text-chunks" && record.type !== "reasoning-chunks" && record.type !== "tool-call-chunks") return [record];
  const data = asRecord(record.data);
  if (data === undefined) return [record];
  const payloadKey = record.type === "tool-call-chunks" ? "args" : "texts";
  const payload = data[payloadKey];
  const seq0 = numberValue(record.seq0);
  const time0 = numberValue(record.time0);
  const turn = numberValue(data.turn);
  const step = numberValue(data.step);
  const index = numberValue(data.index);
  const gaps = data.dt;
  if (seq0 === undefined || time0 === undefined || turn === undefined || step === undefined || index === undefined
    || !Array.isArray(payload) || payload.some((part) => typeof part !== "string")
    || !Array.isArray(gaps) || gaps.length !== payload.length - 1
    || gaps.some((gap) => typeof gap !== "number" || !Number.isFinite(gap))) return [record];
  const id = nonEmptyString(data.id);
  if (record.type === "tool-call-chunks" && id === undefined) return [record];
  const events: JsonRecord[] = [];
  let time = time0;
  for (let offset = 0; offset < payload.length; offset += 1) {
    if (offset > 0) time += gaps[offset - 1] as number;
    const part = payload[offset];
    const chunk = record.type === "text-chunks"
      ? { type: "text-delta", index, text: part }
      : record.type === "reasoning-chunks"
        ? { type: "reasoning-delta", index, text: part }
        : {
          type: "tool-call-delta",
          index,
          id,
          ...(typeof data.name === "string" ? { name: data.name } : {}),
          argumentsDelta: part,
        };
    events.push({
      type: "assistant/chunk",
      seq: seq0 + offset,
      time,
      data: { turn, step, chunk },
    });
  }
  return events;
}

async function findDshSessionArtifact(
  home: string,
  cwd: string,
  startedAt: number,
  resumeSessionId?: string,
): Promise<string | undefined> {
  // A continued actor names its session; take that session or nothing. The
  // discovery below answers "which session did this attempt create", and for a
  // continued actor that question has a wrong answer available: a sibling
  // stage of the same slot shares the project directory, and its file is newer
  // than the resumed one.
  if (resumeSessionId !== undefined) return sessionArtifactForId(home, resumeSessionId);
  const candidates = await sessionArtifactPaths(home, cwd);
  const ranked: Array<{ readonly path: string; readonly mtimeMs: number }> = [];
  for (const path of candidates) {
    try {
      const identity = await stat(path);
      if (identity.mtimeMs >= startedAt - 1000) ranked.push({ path, mtimeMs: identity.mtimeMs });
    } catch {
      // A session can be materialized or repaired between directory listing
      // and stat. The next poll will try it again.
    }
  }
  ranked.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of ranked) {
    try {
      const header = dshSessionHeader(candidate.path, await readFile(candidate.path));
      if (header !== undefined && (nonEmptyString(header.cwd) === undefined || header.cwd === cwd)) return candidate.path;
    } catch {
      // The writer may still be publishing the first frame.
    }
  }
  return undefined;
}

function decodeDshSession(path: string, raw: Buffer): DshSessionEvidence | undefined {
  let text: string;
  try {
    if (path.endsWith(".zstd")) {
      const frames = dshZstdFrames(raw);
      if (frames.length === 0) return undefined;
      text = frames.map(({ start, end }) => zstdDecompressSync(raw.subarray(start, end)).toString("utf8")).join("");
    } else {
      text = raw.toString("utf8");
    }
  } catch {
    return undefined;
  }
  const events = text.split("\n").flatMap((line): readonly JsonRecord[] => {
    if (line.trim() === "") return [];
    try {
      const value: unknown = JSON.parse(line);
      const record = asRecord(value);
      return record === undefined ? [] : expandDshStorageRecord(record);
    } catch {
      return [];
    }
  });
  const header = events.find((event) => event.type === "session");
  const sessionId = nonEmptyString(header?.id);
  if (sessionId === undefined) return undefined;
  return { path, sessionId, text, events };
}

export async function readDshSessionEvidence(
  home: string,
  cwd: string,
  startedAt: number,
  resumeSessionId?: string,
): Promise<DshSessionEvidence | undefined> {
  // Same rule as findDshSessionArtifact: a named session is read by name, and a
  // miss stays a miss. Widening to discovery would read a sibling actor's
  // conversation into this actor's transcript, and the next epoch would replay
  // it back as if it were its own history.
  if (resumeSessionId !== undefined) {
    const known = await sessionArtifactForId(home, resumeSessionId);
    if (known === undefined) return undefined;
    try {
      return decodeDshSession(known, await readFile(known));
    } catch {
      // A writer may still be publishing the first frame; the caller keeps the
      // records it tailed itself.
      return undefined;
    }
  }
  const candidates = await sessionArtifactPaths(home, cwd);
  const ranked: Array<{ readonly path: string; readonly mtimeMs: number }> = [];
  for (const path of candidates) {
    try {
      const identity = await stat(path);
      if (identity.mtimeMs >= startedAt - 1000) ranked.push({ path, mtimeMs: identity.mtimeMs });
    } catch {
      // The child may have removed an incomplete file between listing and stat.
    }
  }
  ranked.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of ranked) {
    try {
      const evidence = decodeDshSession(candidate.path, await readFile(candidate.path));
      const header = evidence?.events.find((event) => event.type === "session");
      if (evidence !== undefined && (nonEmptyString(header?.cwd) === undefined || header?.cwd === cwd)) return evidence;
    } catch {
      // Native evidence is best effort for a successful child. The stdout
      // result remains usable, while the transcript records what was available.
    }
  }
  return undefined;
}

class DshSessionTailerImpl implements DshSessionTailer {
  private readonly seen = new Set<string>();
  private readonly records: JsonRecord[] = [];
  private filePath: string | undefined;
  private fileBytes = 0;
  private plainOffset = 0;
  private zstdFrameCount = 0;
  private pending = Buffer.alloc(0);
  private sessionHeader: JsonRecord | undefined;
  private stopped = false;
  private loop: Promise<void> | undefined;
  private finished: Promise<DshSessionEvidence | undefined> | undefined;

  constructor(
    private readonly home: string,
    private readonly cwd: string,
    private readonly startedAt: number,
    private readonly mapper: DshEventMapper,
    private readonly resumeSessionId?: string,
  ) {}

  start(): void {
    if (this.loop !== undefined) return;
    this.loop = this.pollLoop();
  }

  async finish(): Promise<DshSessionEvidence | undefined> {
    if (this.finished !== undefined) return this.finished;
    this.finished = this.finishOnce();
    return this.finished;
  }

  private async finishOnce(): Promise<DshSessionEvidence | undefined> {
    this.stopped = true;
    await this.loop;
    // One final read closes the race where the process exits immediately after
    // the last persistence batch becomes visible to the filesystem.
    await this.poll();
    const complete = await readDshSessionEvidence(this.home, this.cwd, this.startedAt, this.resumeSessionId);
    if (complete !== undefined) {
      for (const event of complete.events) {
        if (event.type !== "session") this.accept(event);
      }
      return complete;
    }
    return this.sessionHeader === undefined || this.filePath === undefined
      ? undefined
      : {
        path: this.filePath,
        sessionId: nonEmptyString(this.sessionHeader.id) ?? "",
        text: "",
        events: [this.sessionHeader, ...this.records],
      };
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      await this.poll();
      if (!this.stopped) await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  private async poll(): Promise<void> {
    try {
      if (this.filePath === undefined) this.filePath = await findDshSessionArtifact(this.home, this.cwd, this.startedAt, this.resumeSessionId);
      if (this.filePath === undefined) return;
      const raw = await readFile(this.filePath);
      if (this.filePath.endsWith(".zstd")) this.consumeZstd(raw);
      else this.consumePlain(raw);
    } catch {
      // Session discovery and reads are best effort. The final stdout result
      // remains valid when a native artifact is absent or being repaired.
    }
  }

  private resetPhysicalCursor(): void {
    this.fileBytes = 0;
    this.plainOffset = 0;
    this.zstdFrameCount = 0;
    this.pending = Buffer.alloc(0);
  }

  private consumePlain(raw: Buffer): void {
    if (raw.length < this.fileBytes) this.resetPhysicalCursor();
    this.fileBytes = raw.length;
    if (raw.length <= this.plainOffset) return;
    this.consumeDecoded(raw.subarray(this.plainOffset));
    this.plainOffset = raw.length;
  }

  private consumeZstd(raw: Buffer): void {
    if (raw.length < this.fileBytes) this.resetPhysicalCursor();
    this.fileBytes = raw.length;
    const frames = dshZstdFrames(raw);
    for (let index = this.zstdFrameCount; index < frames.length; index += 1) {
      const frame = frames[index];
      if (frame === undefined) continue;
      try {
        this.consumeDecoded(zstdDecompressSync(raw.subarray(frame.start, frame.end)));
      } catch {
        // A frame can become visible between its append and its final fsync;
        // retry it on the next poll rather than advancing the frame cursor.
        break;
      }
      this.zstdFrameCount = index + 1;
    }
  }

  private consumeDecoded(bytes: Buffer): void {
    this.pending = this.pending.length === 0 ? Buffer.from(bytes) : Buffer.concat([this.pending, bytes]);
    let newline = this.pending.indexOf(0x0a);
    while (newline >= 0) {
      const line = this.pending.subarray(0, newline);
      this.pending = this.pending.subarray(newline + 1);
      this.consumeLine(line);
      newline = this.pending.indexOf(0x0a);
    }
  }

  private consumeLine(line: Buffer): void {
    if (line.toString("utf8").trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line.toString("utf8")) as unknown;
    } catch {
      return;
    }
    const record = asRecord(value);
    if (record === undefined) return;
    if (record.type === "session") {
      this.sessionHeader = record;
      return;
    }
    for (const event of expandDshStorageRecord(record)) this.accept(event);
  }

  private accept(record: JsonRecord): void {
    const key = dshRecordKey(record);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.records.push(record);
    this.mapper.process(record);
  }
}

export function createDshSessionTailer(
  home: string,
  cwd: string,
  startedAt: number,
  mapper: DshEventMapper,
  resumeSessionId?: string,
): DshSessionTailerImpl {
  const tailer = new DshSessionTailerImpl(home, cwd, startedAt, mapper, resumeSessionId);
  tailer.start();
  return tailer;
}

