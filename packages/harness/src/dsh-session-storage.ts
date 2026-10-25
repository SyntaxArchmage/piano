import { Duration, Effect, Fiber } from "effect";
import { io } from "@piano/base";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { asRecord, nonEmptyString, numberValue, type JsonRecord } from "./json-narrowing.js";
import { dshRecordKey, type DshEventMapper } from "./dsh-session-events.js";

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
  finish(): Effect.Effect<DshSessionEvidence | undefined>;
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

/** Leaf adapters: one io call each, with failure collapsed to "not there".
 * Every lookup in this module treats an unreadable artifact as absent evidence
 * rather than as a reason to lose the records the caller already tailed. */
function readDirents(path: string) {
  return io.readdir(path).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
}

function statPath(path: string) {
  return io.stat(path).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
}

/** A Buffer view over bytes io read — no copy; the frame walker uses Node's
 * Buffer reading methods. */
function bufferView(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readFileBytes(path: string): Effect.Effect<Buffer | undefined> {
  return io.readFile(path).pipe(
    Effect.map(bufferView),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}

/** The names dsh may have given the artifacts inside one session directory;
 * `undefined` when the directory cannot be read (no such session here). */
function dshSessionArtifactNames(sessionDir: string): Effect.Effect<readonly string[] | undefined> {
  return readDirents(sessionDir).pipe(
    Effect.map((entries) => entries === undefined
      ? undefined
      : dshSessionArtifacts(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))),
  );
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
function sessionArtifactForId(home: string, sessionId: string): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    const sessionsRoot = join(home, "sessions");
    const entries = yield* readDirents(sessionsRoot);
    if (entries === undefined) return undefined;
    const projects = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    for (const project of projects) {
      const sessionDir = join(sessionsRoot, project, sessionId);
      const names = yield* dshSessionArtifactNames(sessionDir);
      // An unreadable directory means this project key does not hold the session;
      // keep looking, exactly as a failed stat on a named candidate did.
      if (names === undefined) continue;
      if (names.length > 0) return join(sessionDir, names[0] ?? "");
    }
    return undefined;
  });
}

function sessionArtifactPaths(home: string, cwd: string): Effect.Effect<readonly string[]> {
  return Effect.gen(function* () {
    const sessionsRoot = join(home, "sessions");
    const expectedProject = join(sessionsRoot, dshProjectKey(cwd));
    const projects: string[] = [];
    if ((yield* statPath(expectedProject)) !== undefined) {
      projects.push(expectedProject);
    } else {
      // The fallback scan below handles older dsh layouts and lossy project-key
      // collisions without assuming a native implementation detail forever.
      const rootEntries = yield* readDirents(sessionsRoot);
      if (rootEntries === undefined) return [];
      for (const entry of rootEntries) {
        if (entry.isDirectory()) projects.push(join(sessionsRoot, entry.name));
      }
    }
    const paths: string[] = [];
    for (const project of projects) {
      const entries = yield* readDirents(project);
      if (entries === undefined) continue;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionDir = join(project, entry.name);
        // A concurrent dsh cleanup can remove an incomplete session, which reads
        // here as an unreadable directory.
        const names = yield* dshSessionArtifactNames(sessionDir);
        if (names === undefined) continue;
        for (const filename of names) paths.push(join(sessionDir, filename));
      }
    }
    return paths;
  });
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

/** The delta-chunk events both dsh packed-row shapes expand to. Shared so the
 * top-level (v0/v1) and in-message (v3 `data.stream`) expanders cannot drift.
 * `seq0 === undefined` omits the seq entirely: v3 members carry no sequence
 * number to derive one from, and the tailer's dedupe then keys each chunk by
 * content instead — synthesizing a shared seq would collapse a whole expansion
 * into its first event. */
function dshChunkEvents(
  kind: "text-chunks" | "reasoning-chunks" | "tool-call-chunks",
  parts: {
    readonly turn: number;
    readonly step: number;
    readonly index: number;
    readonly time0: number;
    readonly dt: readonly number[];
    readonly payload: readonly string[];
    readonly id?: string;
    readonly name?: string;
  },
  seq0: number | undefined,
): readonly JsonRecord[] {
  const events: JsonRecord[] = [];
  let time = parts.time0;
  for (let offset = 0; offset < parts.payload.length; offset += 1) {
    if (offset > 0) time += parts.dt[offset - 1] as number;
    const part = parts.payload[offset];
    const chunk = kind === "text-chunks"
      ? { type: "text-delta", index: parts.index, text: part }
      : kind === "reasoning-chunks"
        ? { type: "reasoning-delta", index: parts.index, text: part }
        : {
          type: "tool-call-delta",
          index: parts.index,
          ...(parts.id === undefined ? {} : { id: parts.id }),
          ...(parts.name === undefined ? {} : { name: parts.name }),
          argumentsDelta: part,
        };
    events.push({
      type: "assistant/chunk",
      ...(seq0 === undefined ? {} : { seq: seq0 + offset }),
      time,
      data: { turn: parts.turn, step: parts.step, chunk },
    });
  }
  return events;
}

/** The validated delta parts one packed row carries, or undefined when the row
 * is malformed. Shared by both packed-row shapes so their validation cannot
 * drift: every part is a string, the gaps are finite numbers with exactly one
 * fewer entry than the payload, and a tool call names itself. */
function packedChunkParts(
  kind: "text-chunks" | "reasoning-chunks" | "tool-call-chunks",
  source: JsonRecord,
): { readonly payload: readonly string[]; readonly dt: readonly number[]; readonly id?: string; readonly name?: string } | undefined {
  const payload = source[kind === "tool-call-chunks" ? "args" : "texts"];
  const dt = source.dt;
  const id = nonEmptyString(source.id);
  if (!Array.isArray(payload) || payload.some((part) => typeof part !== "string")) return undefined;
  if (!Array.isArray(dt) || dt.length !== payload.length - 1) return undefined;
  if (dt.some((gap) => typeof gap !== "number" || !Number.isFinite(gap))) return undefined;
  if (kind === "tool-call-chunks" && id === undefined) return undefined;
  return {
    payload,
    dt,
    ...(id === undefined ? {} : { id }),
    ...(typeof source.name === "string" ? { name: source.name } : {}),
  };
}

/** Expand the packed delta members a v3 `assistant/message` carries inside
 * `data.stream`. Real v3 artifacts (verified against installed dsh 0.1.5
 * storage: 26 of 50 messages in one session) hold every text/reasoning/
 * tool-call delta there and write no top-level packed rows at all — without
 * this expansion a live dsh turn emits zero text deltas and the TUI only sees
 * whole messages at step boundaries. Members are validated individually: a
 * malformed member is skipped, the parent record is never dropped. */
function expandDshStreamMembers(data: JsonRecord): readonly JsonRecord[] {
  const stream = data.stream;
  if (!Array.isArray(stream)) return [];
  const turn = numberValue(data.turn);
  const step = numberValue(data.step);
  if (turn === undefined || step === undefined) return [];
  const events: JsonRecord[] = [];
  for (const member of stream) {
    const packed = asRecord(member);
    if (packed === undefined) continue;
    const kind = packed.type;
    if (kind !== "text-chunks" && kind !== "reasoning-chunks" && kind !== "tool-call-chunks") continue;
    const time0 = numberValue(packed.time0);
    const index = numberValue(packed.index);
    const parts = packedChunkParts(kind, packed);
    if (time0 === undefined || index === undefined || parts === undefined) continue;
    events.push(...dshChunkEvents(kind, {
      turn,
      step,
      index,
      time0,
      dt: parts.dt,
      payload: parts.payload,
      ...(parts.id === undefined ? {} : { id: parts.id }),
      ...(parts.name === undefined ? {} : { name: parts.name }),
    }, undefined));
  }
  return events;
}

/** dsh's JSONL writer packs runs of three or more delta chunks into a storage
 * row. The installed dsh reader expands these rows before exposing
 * `Session.events`; Piano must do the same at the process boundary so a packed
 * row remains a live text stream rather than an opaque unknown event. Two
 * physical shapes exist: v0/v1 writes packed rows top-level; v3 embeds them as
 * members of the step's `assistant/message` record (`data.stream`). Exported
 * for tests — the purest seam to pin both shapes against real captures. */
export function expandDshStorageRecord(record: JsonRecord): readonly JsonRecord[] {
  const data = asRecord(record.data);
  if (data !== undefined && Array.isArray(data.stream)) {
    // Chunks expand ahead of their message: the live stream animates, then the
    // terminal message_end dedupes against the assembled text as usual.
    return [...expandDshStreamMembers(data), record];
  }
  if (record.type !== "text-chunks" && record.type !== "reasoning-chunks" && record.type !== "tool-call-chunks") return [record];
  if (data === undefined) return [record];
  const seq0 = numberValue(record.seq0);
  const time0 = numberValue(record.time0);
  const turn = numberValue(data.turn);
  const step = numberValue(data.step);
  const index = numberValue(data.index);
  const parts = packedChunkParts(record.type, data);
  if (seq0 === undefined || time0 === undefined || turn === undefined || step === undefined
    || index === undefined || parts === undefined) {
    return [record];
  }
  return dshChunkEvents(record.type, {
    turn,
    step,
    index,
    time0,
    dt: parts.dt,
    payload: parts.payload,
    ...(parts.id === undefined ? {} : { id: parts.id }),
    ...(parts.name === undefined ? {} : { name: parts.name }),
  }, seq0);
}


/** The newest session artifact under this cwd that `read` accepts, or nothing.
 * Candidates are the attempt's own sessions — created since it started (with a
 * second of slack for clock granularity) and never a sibling cwd's — tried
 * newest first, because a later file may be a repair of an earlier one. A read
 * that throws is skipped: a writer may still be publishing its first frame, or
 * the child may have removed an incomplete file between listing and stat. */
function scanSessionArtifacts<T>(
  home: string,
  cwd: string,
  startedAt: number,
  read: (path: string, raw: Buffer) => T | undefined,
): Effect.Effect<T | undefined> {
  return Effect.gen(function* () {
    const candidates = yield* sessionArtifactPaths(home, cwd);
    const ranked: Array<{ readonly path: string; readonly mtimeMs: number }> = [];
    for (const path of candidates) {
      const identity = yield* statPath(path);
      // Unreadable between listing and stat; the next poll tries it again.
      if (identity !== undefined && identity.mtimeMs >= startedAt - 1000) {
        ranked.push({ path, mtimeMs: identity.mtimeMs });
      }
    }
    ranked.sort((left, right) => right.mtimeMs - left.mtimeMs);
    for (const candidate of ranked) {
      const raw = yield* readFileBytes(candidate.path);
      if (raw === undefined) continue;
      // Best effort: the stdout result stays usable without native evidence.
      const value = yield* Effect.sync(() => read(candidate.path, raw)).pipe(
        Effect.catchAllDefect(() => Effect.succeed(undefined)),
      );
      if (value !== undefined) return value;
    }
    return undefined;
  });
}

/** Whether a header's cwd claim matches the cwd that is looking. A header that
 * claims nothing is accepted — some writers omit it. */
function headerCwdMatches(claimed: unknown, cwd: string): boolean {
  return nonEmptyString(claimed) === undefined || nonEmptyString(claimed) === cwd;
}

function findDshSessionArtifact(
  home: string,
  cwd: string,
  startedAt: number,
  resumeSessionId?: string,
): Effect.Effect<string | undefined> {
  // A continued actor names its session; take that session or nothing. The
  // discovery below answers "which session did this attempt create", and for a
  // continued actor that question has a wrong answer available: a sibling
  // stage of the same slot shares the project directory, and its file is newer
  // than the resumed one.
  if (resumeSessionId !== undefined) return sessionArtifactForId(home, resumeSessionId);
  return scanSessionArtifacts(home, cwd, startedAt, (path, raw) => {
    const header = dshSessionHeader(path, raw);
    return header !== undefined && headerCwdMatches(header.cwd, cwd) ? path : undefined;
  });
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

function readDshSessionEvidenceOnce(
  home: string,
  cwd: string,
  startedAt: number,
  resumeSessionId?: string,
): Effect.Effect<DshSessionEvidence | undefined> {
  return Effect.gen(function* () {
    // Same rule as findDshSessionArtifact: a named session is read by name, and a
    // miss stays a miss. Widening to discovery would read a sibling actor's
    // conversation into this actor's transcript, and the next epoch would replay
    // it back as if it were its own history.
    if (resumeSessionId !== undefined) {
      const known = yield* sessionArtifactForId(home, resumeSessionId);
      if (known === undefined) return undefined;
      const raw = yield* readFileBytes(known);
      if (raw === undefined) {
        // A writer may still be publishing the first frame; the caller keeps the
        // records it tailed itself.
        return undefined;
      }
      return yield* Effect.sync(() => decodeDshSession(known, raw)).pipe(
        Effect.catchAllDefect(() => Effect.succeed(undefined)),
      );
    }
    return yield* scanSessionArtifacts(home, cwd, startedAt, (path, raw) => {
      const evidence = decodeDshSession(path, raw);
      const header = evidence?.events.find((event) => event.type === "session");
      return evidence !== undefined && headerCwdMatches(header?.cwd, cwd) ? evidence : undefined;
    });
  });
}

/** Read what the child persisted; a miss and an unreadable artifact are both
 * "no evidence" so an interrupted turn keeps the records it tailed itself. */
export function readDshSessionEvidence(
  home: string,
  cwd: string,
  startedAt: number,
  resumeSessionId?: string,
): Effect.Effect<DshSessionEvidence | undefined> {
  return readDshSessionEvidenceOnce(home, cwd, startedAt, resumeSessionId).pipe(
    Effect.catchAllDefect(() => Effect.succeed(undefined)),
  );
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
  private loop: Fiber.RuntimeFiber<void, never> | undefined;
  private finishResult: { readonly value: DshSessionEvidence | undefined } | undefined;

  constructor(
    private readonly home: string,
    private readonly cwd: string,
    private readonly startedAt: number,
    private readonly mapper: DshEventMapper,
    private readonly resumeSessionId?: string,
  ) {}

  start(): void {
    if (this.loop !== undefined) return;
    this.loop = Effect.runFork(this.pollLoop());
  }

  finish(): Effect.Effect<DshSessionEvidence | undefined> {
    return Effect.suspend(() => {
      const cached = this.finishResult;
      if (cached !== undefined) return Effect.succeed(cached.value);
      return this.finishOnce().pipe(
        Effect.catchAllDefect(() => Effect.succeed(undefined)),
        Effect.map((value) => {
          this.finishResult = { value };
          return value;
        }),
      );
    });
  }

  private finishOnce(): Effect.Effect<DshSessionEvidence | undefined> {
    return Effect.suspend(() => {
      this.stopped = true;
      const settled = this.loop === undefined ? Effect.void : Fiber.await(this.loop).pipe(Effect.asVoid);
      // One final read closes the race where the process exits immediately after
      // the last persistence batch becomes visible to the filesystem.
      return settled.pipe(
        Effect.flatMap(() => this.poll()),
        Effect.flatMap(() => readDshSessionEvidenceOnce(this.home, this.cwd, this.startedAt, this.resumeSessionId)),
        Effect.map((complete) => this.evidenceAfterFinish(complete)),
      );
    });
  }

  /** The persisted evidence, or the records this tailer read itself. */
  private evidenceAfterFinish(complete: DshSessionEvidence | undefined): DshSessionEvidence | undefined {
    if (complete !== undefined) {
      for (const event of complete.events) {
        if (event.type !== "session") this.accept(event);
      }
      return complete;
    }
    const header = this.sessionHeader;
    const filePath = this.filePath;
    return header === undefined || filePath === undefined
      ? undefined
      : {
        path: filePath,
        sessionId: nonEmptyString(header.id) ?? "",
        text: "",
        events: [header, ...this.records],
      };
  }

  private pollLoop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.stopped) return Effect.void;
      return this.poll().pipe(
        Effect.flatMap(() => this.stopped
          ? Effect.void
          : Effect.sleep(Duration.millis(50)).pipe(Effect.flatMap(() => this.pollLoop()))),
      );
    });
  }

  private poll(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.filePath === undefined) {
        return findDshSessionArtifact(this.home, this.cwd, this.startedAt, this.resumeSessionId).pipe(
          Effect.flatMap((found) => {
            this.filePath = found;
            return found === undefined ? Effect.void : this.consumeArtifact(found);
          }),
        );
      }
      return this.consumeArtifact(this.filePath);
    }).pipe(
      // Session discovery and reads are best effort. The final stdout result
      // remains valid when a native artifact is absent or being repaired.
      Effect.catchAllDefect(() => Effect.void),
    );
  }

  private consumeArtifact(path: string): Effect.Effect<void> {
    return readFileBytes(path).pipe(
      Effect.map((raw) => {
        if (raw === undefined) return;
        if (path.endsWith(".zstd")) this.consumeZstd(raw);
        else this.consumePlain(raw);
      }),
    );
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

  /** Consume complete JSONL records from a physical file prefix. Plain JSONL
   * writes and zstd frames can both be observed halfway through a write, so the
   * byte buffer retains the final unterminated record until the next poll. */
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

