// The dsh resume plugin, exercised for real but without dsh.
//
// The launcher imports this plugin inside its own process, and the packages it
// imports live in the dsh installation rather than in this repository, so the
// test supplies stub modules and drives the shipped plugin file in a child
// process. What is under test is Piano's own logic — which session the turn runs
// on, and what happens when it cannot resume — not dsh's.
//
// The code word is the whole point. The fake agent stands in for dsh's model
// loop, and it can answer with the code word ONLY when that word is already in
// the session it was handed. A freshly created session is empty, so a passing
// recall means a session was genuinely reopened. That is the mock mirror of the
// real-model acceptance in tests/harness/real-subprocess.e2e.test.ts, which
// proves the same property against a real launcher and a real model:
// locally and in the gated run the assertions are identical, only the thing
// answering the question differs.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DSH_RESUME_SESSION_ENV } from "../../packages/harness/src/index.js";

const runnerPath = fileURLToPath(new URL("../../packages/harness/src/dsh-resume-runner.mjs", import.meta.url));

/** The word the fake model can only know from a resumed session. Kept equal to
 * the seed the real-model acceptance uses, so both tiers ask the same question. */
const CODE_WORD = "BLUE-HARBOR-77";

/** A session id in the shape dsh mints, and the shape the adapter only forwards. */
const RESUME_ID = "session-40b6f4bb-023f-453a-84f1-74505294dce2";

/** Stubs for the four dsh packages the plugin imports. Each is only as
 * faithful as the contract the plugin actually uses. */
const STUBS: Readonly<Record<string, string>> = {
  "@deepseek-ai/schemastery": `
// Stub of the schema builder used to declare the plugin's config.
const string = () => ({ required: () => ({ type: "string" }) });
export default { object: (shape) => ({ type: "object", shape }), string };
`,
  "@deepseek-ai/dsh-agent": `
// Stub of the model-selection installer. It records the call so the test can
// see that the plugin ran the setup dsh requires, and it returns a handle with
// no \`.commit\`: the real one returns the same kind of value, which is what made
// returning it from \`setup\` fail the mount with "commit is not a function".
export function installModelSelection(ctx, options) {
  const calls = (globalThis.__dshCalls ??= {});
  (calls.installModelSelection ??= []).push({ current: options && options.current });
  return { applied: true };
}
`,
  "@deepseek-ai/dsh-llm": `
// Stub of the user-message constructor: the plugin only needs a value to hand
// to the agent, in the shape the summarizer reads back.
export function createUserMessage(input) {
  return { content: input.content, source: input.source };
}
`,
  "@deepseek-ai/dsh-session": `
// Stub of the id brand. The real one brands a string, so identity is faithful.
export function SessionId(id) {
  return id;
}
`,
};

/** The child process: a fake Cordis host around the shipped plugin. */
const HOST = `
import { writeFileSync } from "node:fs";
import { apply } from "./resume-runner.mjs";

const codeWord = process.env.PIANO_FAKE_CODEWORD;
const scenario = process.env.PIANO_FAKE_SCENARIO;
const resumeId = process.env.PIANO_FAKE_RESUME_ID;

// A turn that ends in error must report it in both channels Piano reads: the
// exit code it branches on, and the stderr it records as an observable event.
const turnEnd = scenario === "errors"
  ? { kind: "error", error: { code: "FAKE_FAILURE", message: "the model gave up" } }
  : { kind: "completed" };

const calls = { resume: [], create: [], installModelSelection: [], steered: [], flushed: 0 };
globalThis.__dshCalls = calls;

let stdout = "";
let stderr = "";
const realStdout = process.stdout.write.bind(process.stdout);
const realStderr = process.stderr.write.bind(process.stderr);
// Both channels are accumulated for the report, but stderr is ALSO passed
// through as it is written. The runner's steering handshake is a line on
// stderr, and the far end has to see it while the turn is live — buffering the
// stream until the end would make the notice arrive only after there is nothing
// left to steer, which is exactly the timing the handshake removes.
process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
process.stderr.write = (chunk) => { stderr += String(chunk); realStderr(chunk); return true; };

function userText(event) {
  const content = event.data && (event.data.content || (event.data.message && event.data.message.content));
  return Array.isArray(content)
    ? content.filter((block) => block.type === "text").map((block) => block.text).join("")
    : "";
}

// The transition channel the real plugin context exposes, modelled on Cordis's
// event bus as dsh's own invariant plugin uses it: ctx.on(name, fn, options)
// returns a disposer and there is no ctx.off, so the fake mirrors that shape -
// a runner written against an off method the real context lacks would pass
// here and throw in production. Handlers fire synchronously, so a listener
// observes the state it was told about in the same tick the agent moved -
// which is what makes the runner's per-frame liveness read and its disarm
// agree.
const statusListeners = [];
// Frames the test wants delivered in the turn-boundary window: written as
// the idle transition is dispatched, which is the instant the turn ends and
// before the runner's awaited turn promise can resume. The write is emitted
// onto the runner's own stdin stream here rather than by the parent, so the
// timing is the boundary itself and not a race with a process boundary.
let lateSteerLines = process.env.PIANO_FAKE_LATE_STEERS === undefined
  ? []
  : process.env.PIANO_FAKE_LATE_STEERS.split("\\u0001");
function emitStatus(agent, status) {
  if (status === "idle" && lateSteerLines.length > 0) {
    const lines = lateSteerLines.splice(0);
    for (const line of lines) process.stdin.emit("data", line + "\\n");
  }
  for (const handler of statusListeners.slice()) handler({ agent, status });
}

// The stand-in model loop. It answers from its own session's history, so the
// code word is reachable only through a session that already holds it.
function agentFor(id, history) {
  const events = history.slice();
  let seq = events.length;
  // The turn in flight, so whenIdle can mean what the real agent's means:
  // resolved while idle, pending while the followup turn is running.
  let turnDone = Promise.resolve();
  // The lifecycle the real Agent exposes: its status property mirrors every
  // agent/status transition, and the transition is synchronous in both
  // directions. The runner reads this per frame, so the fake has to actually
  // move it on the same ticks the real one would - a status that only changed
  // after the turn promise settled would hide the very window under test.
  let status = "idle";
  const agent = {
    id,
    // Current dsh deliberately keeps the append-only log private. Expose only
    // the public Session APIs so a regression to \`session.events\` fails here.
    session: {
      get seq() { return seq; },
      eventAt: (index) => events[index],
      snapshotEvents: (from = 0, to = seq) => Object.freeze(events.slice(from, to)),
    },
    get status() { return status; },
    whenIdle: () => turnDone,
    steer: (message) => {
      // The host's Agent.steer joins the running turn as a user interjection;
      // the fake records it (for the report) and lets the same turn answer
      // with it. A dsh that refuses the injection throws, which is the case
      // the runner must report as refused rather than delivered.
      if (process.env.PIANO_FAKE_STEER_REFUSAL) throw new Error(process.env.PIANO_FAKE_STEER_REFUSAL);
      calls.steered.push(userText({ data: message }));
      events.push({ seq: seq++, type: "user/message", data: message });
    },
    followup: (message) => {
      // A waking delivery enters running synchronously, before the turn's
      // work runs - the real contract the runner's arm relies on.
      if (status !== "running") { status = "running"; emitStatus(agent, "running"); }
      turnDone = (async () => {
        // A short async gap so the test can interleave a stdin steer frame
        // between the turn starting and it ending — the window a live steer
        // has.
        const delay = Number(process.env.PIANO_FAKE_FOLLOWUP_DELAY);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        const seen = events.map(userText).join("\\\\n");
        const steered = calls.steered;
        const answer = seen.includes(codeWord) ? codeWord : steered.length > 0 ? steered.join(" ") : "I do not know any code word";
        events.push({ seq: seq++, type: "turn/start", data: {} });
        events.push({ seq: seq++, type: "user/message", data: message });
        events.push({ seq: seq++, type: "assistant/message", data: { message: { content: [{ type: "text", text: answer }] } } });
        events.push({ seq: seq++, type: "turn/end", data: { reason: turnEnd } });
        // idle means no driver remains scheduled or active: the promise the
        // runner awaits and the status transition settle together.
        if (status !== "idle") { status = "idle"; emitStatus(agent, "idle"); }
      })();
    },
  };
  return agent;
}

// The persisted conversation, as dsh's storage would hand it back on resume.
const persisted = [
  { seq: 0, type: "user/message", data: { content: [{ type: "text", text: "Remember this code word: " + codeWord }] } },
];

// Records what the plugin asked for, and what its setup callback returned.
function record(options) {
  const entry = { agentOptions: options.agentOptions, hasSetup: typeof options.setup === "function" };
  entry.setupResult = "not-run";
  if (entry.hasSetup) {
    try {
      const value = options.setup({ fakeAgentCtx: true });
      entry.setupResult = value === undefined ? "undefined" : "value";
    } catch (error) {
      entry.setupResult = "threw: " + error.message;
    }
  }
  return entry;
}

const agents = {
  create: async (options) => {
    calls.create.push(Object.assign({ sessionId: String(options.sessionId) }, record(options)));
    return { agent: agentFor(options.sessionId, []) };
  },
};
if (scenario !== "absent") {
  agents.resume = async (options) => {
    calls.resume.push(Object.assign({ resumeSessionId: String(options.resumeSessionId) }, record(options)));
    if (scenario === "throws") throw new Error("session not found in storage");
    return { agent: agentFor(options.resumeSessionId, persisted) };
  };
}

let finish;
const done = new Promise((resolve) => { finish = resolve; });

const services = {
  loader: { await: async () => {} },
  agents,
  agentDefaultModel: { currentSelection: () => ({ provider: "fake-provider", model: "fake-model" }) },
  sessions: { flush: async () => { calls.flushed += 1; } },
  appExit: (code) => { calls.exitCode = Number(code) || 0; finish(); },
};
const ctx = {
  get: (name) => services[name],
  // The real ctx.on takes (name, listener, options) and returns a disposer —
  // there is no ctx.off. The disposer removes the listener when the turn ends.
  on: (name, handler, options) => {
    if (name !== "agent/status") return () => false;
    statusListeners.push(handler);
    return () => {
      const at = statusListeners.indexOf(handler);
      if (at < 0) return false;
      statusListeners.splice(at, 1);
      return true;
    };
  },
};

apply(ctx, { task: "What code word did I ask you to remember? Reply with the code word only." });

const timer = setTimeout(() => { calls.timedOut = true; finish(); }, 5000);
await done;
clearTimeout(timer);

// Hold the process open for a moment before reporting, so a frame written
// after the turn ended is still read by the draining stdin reader — the window
// in which the runner has to answer "no turn to join" instead of going quiet.
const holdOpen = Number(process.env.PIANO_FAKE_HOLD_OPEN);
if (holdOpen > 0) await new Promise((resolve) => setTimeout(resolve, holdOpen));

process.stdout.write = realStdout;
process.stderr.write = realStderr;
writeFileSync(process.env.PIANO_FAKE_REPORT, JSON.stringify(Object.assign({}, calls, { stdout, stderr }), null, 2));
// stderr already went out line by line above; only the answer needs replaying,
// and the report carries both regardless.
realStdout(stdout);
// No explicit process.exit here, on purpose: the real launcher does not hard
// exit from appExit either — it disposes the tree, sets the exit code, and
// lets the event loop drain. The fake mirrors that so a reader that holds the
// loop open (a stdin handle never unref'd) hangs the child and fails the
// test, instead of being papered over by a forced exit.
process.exitCode = Number(calls.exitCode) || 0;
`;

interface RunnerCall {
  readonly resumeSessionId?: string;
  readonly sessionId?: string;
  readonly agentOptions?: { readonly provider: string; readonly model: string };
  readonly hasSetup: boolean;
  readonly setupResult: string;
}

interface RunnerReport {
  readonly resume: readonly RunnerCall[];
  readonly create: readonly RunnerCall[];
  readonly installModelSelection: readonly unknown[];
  readonly steered: readonly string[];
  readonly flushed: number;
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
}

/** One steer decision the runner reported on the ack channel, in the order it
 * was read off stderr. `accepted: false` is the runner's own
 * `no-active-turn`: Piano reports a steer as delivered only when a live turn
 * took it, so a refusal has to be stated rather than silently written. */
interface SteerAck {
  readonly id?: string;
  readonly accepted: boolean;
  readonly reason?: string;
}

function steerAcks(report: RunnerReport): readonly SteerAck[] {
  return report.stderr.split("\n").flatMap((line) => {
    const at = line.indexOf("piano-steer:");
    if (at < 0) return [];
    try {
      return [JSON.parse(line.slice(at + "piano-steer:".length)) as SteerAck];
    } catch {
      return [];
    }
  });
}

/** Resolve once the runner reports that its steering reader is attached, so a
 * frame can be written knowing it will be read. The line is the runner's own
 * statement about its state, which is the only thing the far end can observe
 * without inspecting the child; the timeout is the child dying before it ever
 * got there, which the close handler then reports properly. */
function waitForReady(stderr: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve) => {
    let seen = "";
    const timer = setTimeout(resolve, 30_000);
    stderr.on("data", (chunk: string) => {
      seen += chunk;
      if (!seen.includes("steering ready")) return;
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Run the shipped plugin in a child process against the stub tree, and report
 * everything it did. `resumeSessionId` is what Piano would pass when the actor has
 * a session to reopen; omitting it is a first turn. */
async function drive(options: {
  readonly scenario: "ok" | "throws" | "absent" | "errors";
  readonly resumeSessionId?: string;
  /** Stdin lines Piano writes, sent only after the runner says its steering
   * reader is attached — the handshake that makes the write a delivery rather
   * than a race with the runner's initialization. */
  readonly steerLines?: readonly string[];
  /** Milliseconds to hold the fake `followup` open, widening the mid-turn
   * window so the steer lines above land while the turn is running. */
  readonly followupDelayMs?: number;
  /** Hold the child's exit open this long, so a frame written after the turn
   * ends is read by the draining reader instead of racing process teardown. */
  readonly holdOpenMs?: number;
  /** A message for the fake `Agent.steer` to throw: the refusal the runner has
   * to report on the ack channel rather than claim as delivered. */
  readonly steerRefusal?: string;
  /** Hold the steer frames until the fake agent reports the idle transition,
   * putting them in the window between the turn ending and the runner's close
   * rather than safely inside the turn. */
  readonly steerAtTurnEnd?: boolean;
}): Promise<RunnerReport> {
  const root = await mkdtemp(join(tmpdir(), "piano-dsh-runner-"));
  try {
    const modulesRoot = join(root, "node_modules");
    for (const [specifier, source] of Object.entries(STUBS)) {
      const directory = join(modulesRoot, specifier);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "package.json"), '{"type":"module","main":"index.mjs"}\n', "utf8");
      await writeFile(join(directory, "index.mjs"), source, "utf8");
    }
    // The plugin is copied rather than referenced, exactly as the harness home
    // does it, so the test drives the shipped bytes in the layout dsh sees.
    const shipped = await readFile(runnerPath, "utf8");
    await writeFile(join(root, "resume-runner.mjs"), shipped, "utf8");
    await writeFile(join(root, "host.mjs"), HOST, "utf8");
    const reportPath = join(root, "report.json");

    let childStderr = "";
    const exit = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, "host.mjs")], {
        cwd: root,
        env: {
          ...process.env,
          PIANO_FAKE_SCENARIO: options.scenario,
          PIANO_FAKE_CODEWORD: CODE_WORD,
          PIANO_FAKE_REPORT: reportPath,
          ...(options.followupDelayMs === undefined ? {} : { PIANO_FAKE_FOLLOWUP_DELAY: String(options.followupDelayMs) }),
          ...(options.holdOpenMs === undefined ? {} : { PIANO_FAKE_HOLD_OPEN: String(options.holdOpenMs) }),
          ...(options.steerRefusal === undefined ? {} : { PIANO_FAKE_STEER_REFUSAL: options.steerRefusal }),
          ...(options.steerAtTurnEnd === true
            ? { PIANO_FAKE_LATE_STEERS: (options.steerLines ?? []).join("\\u0001") }
            : {}),
          ...(options.resumeSessionId === undefined ? {} : {
            PIANO_FAKE_RESUME_ID: options.resumeSessionId,
            [DSH_RESUME_SESSION_ENV]: options.resumeSessionId,
          }),
        },
      });
      child.stderr?.on("data", (chunk) => { childStderr += String(chunk); });
      child.once("error", reject);
      child.once("close", resolve);
      if (options.steerLines !== undefined && options.steerAtTurnEnd !== true) {
        // The far end waits for the runner's own "steering ready" line before
        // writing. A frame written earlier is kept only if the pipe happened to
        // hold it until readline attached — a race the runner's initialization
        // window (loader, agent, resume) makes easy to lose, and the failure is
        // silent: the runner never sees the frame and Piano never learns why.
        waitForReady(child.stderr).then(() => {
          for (const line of options.steerLines ?? []) child.stdin.write(`${line}\n`);
        });
      }
    });

    const report = JSON.parse(await readFile(reportPath, "utf8").catch(() => {
      throw new Error(`no report; child stderr was:\n${childStderr}`);
    })) as RunnerReport;
    expect(report.timedOut, "the plugin never requested an exit").toBeUndefined();
    // The plugin's exit-code contract belongs to the scenarios: failure
    // scenarios exit 1 (asserted below), the rest exit 0.
    const failing = options.scenario === "throws" || options.scenario === "absent" || options.scenario === "errors";
    expect(exit).toBe(failing ? 1 : 0);
    return report;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("dsh resume plugin", () => {
  it("reopens the actor's session, and the code word comes back", async () => {
    const report = await drive({ scenario: "ok", resumeSessionId: RESUME_ID });

    // The session Piano asked for is the one dsh was told to load, with the model
    // this run was configured for rather than the one the session was made with.
    expect(report.resume).toHaveLength(1);
    expect(report.resume[0]?.resumeSessionId).toBe(RESUME_ID);
    expect(report.resume[0]?.agentOptions).toEqual({ provider: "fake-provider", model: "fake-model" });
    // Nothing was created: a resumed turn must not open a second conversation.
    expect(report.create).toEqual([]);
    expect(report.stderr).toContain(`resumed ${RESUME_ID}`);
    expect(report.flushed).toBe(1);

    // The code word was never sent to this process outside the persisted
    // session, so the only way it can appear is through the reopened one.
    expect(report.stdout).toContain(CODE_WORD);

    // The setup dsh requires ran, and handed back nothing: the agent loop calls
    // `.commit()` on its return value, so a value here fails the mount.
    expect(report.installModelSelection).toHaveLength(1);
    expect(report.resume[0]?.hasSetup).toBe(true);
    expect(report.resume[0]?.setupResult).toBe("undefined");
  });

  it("opens a fresh session when there is nothing to reopen, and cannot recall", async () => {
    const report = await drive({ scenario: "ok" });

    expect(report.resume).toEqual([]);
    expect(report.create).toHaveLength(1);
    expect(report.create[0]?.sessionId).toMatch(/^session-[0-9a-f-]{36}$/);
    expect(report.stderr).toContain("new session");
    expect(report.flushed).toBe(1);

    // The same question, with no session behind it: the code word is not there
    // to be had. This is what makes the recall above meaningful.
    expect(report.stdout).not.toContain(CODE_WORD);
    expect(report.create[0]?.setupResult).toBe("undefined");
  });

  // A session that was cancelled before dsh ever named itself leaves Piano with
  // its own logical id, which names no dsh session. Resuming it would fail, and
  // the adapter does not even offer it (see subprocess.test.ts); this is the
  // deeper safety net for the case where storage lost the session entirely.
  it("fails the turn when the session it was told to reopen cannot be loaded", async () => {
    const report = await drive({ scenario: "throws", resumeSessionId: RESUME_ID });

    expect(report.resume).toHaveLength(1);
    expect(report.resume[0]?.resumeSessionId).toBe(RESUME_ID);
    // No second conversation. An actor that asked to continue one must not be
    // handed a blank one: the stage would run with none of its memory while the
    // run's records still claimed continuity, which is exactly the failure this
    // plugin exists to prevent.
    expect(report.create).toEqual([]);
    expect(report.stderr).toContain(`could not resume ${RESUME_ID}`);
    expect(report.stderr).toContain("session not found in storage");
    // Piano decides a stage by the child's exit code, so an unresumable request
    // must not exit zero — the run fails loudly instead of quietly losing the
    // actor's memory.
    expect(report.exitCode).toBe(1);
    expect(report.stdout).not.toContain(CODE_WORD);
  });

  // An older or drifted dsh may not expose the registry's resume at all. Its
  // effect is indistinguishable from a lost session — the actor continues
  // without its memory — so it fails the turn the same way. Piano's retry
  // boundary treats the resulting exit as retryable, so a dsh that only lacks
  // the capability on one attempt still recovers.
  it("fails the turn when the installed dsh cannot resume at all", async () => {
    const report = await drive({ scenario: "absent", resumeSessionId: RESUME_ID });

    expect(report.resume).toEqual([]);
    expect(report.create).toEqual([]);
    expect(report.stderr).toContain("cannot resume");
    expect(report.stderr).toContain(RESUME_ID);
    expect(report.exitCode).toBe(1);
    expect(report.stdout).not.toContain(CODE_WORD);
  });

  // Piano decides whether a stage passed by the child's exit code, so a turn that
  // failed must not exit zero — including when the resume it started from worked.
  it("reports a failed turn through the exit code and stderr", async () => {
    const report = await drive({ scenario: "errors", resumeSessionId: RESUME_ID });

    expect(report.resume).toHaveLength(1);
    expect(report.exitCode).toBe(1);
    expect(report.stderr).toContain("FAKE_FAILURE: the model gave up");
    // The conversation was still reopened: a failed turn does not undo that, and
    // the next epoch has somewhere to come back to.
    expect(report.stderr).toContain(`resumed ${RESUME_ID}`);
  });

  // The steering window: a frame written while the turn runs reaches the agent
  // before it finishes, as a user interjection — the real dsh `Agent.steer`
  // contract the runner adapts stdin frames to — and is answered on the ack
  // channel, which is what lets the far end report it as delivered.
  it("delivers a stdin steer frame into the live turn and acknowledges it", async () => {
    const report = await drive({
      scenario: "ok",
      followupDelayMs: 400,
      steerLines: ['{"type":"steer","id":"steer-1","text":"steer-live-text"}'],
    });

    expect(report.steered).toEqual(["steer-live-text"]);
    // The fake answers from the steer when there is no code word, so the reply
    // proves the frame joined the turn, not a later one.
    expect(report.stdout).toContain("steer-live-text");
    expect(report.stderr).toContain("steer delivered: steer-live-text");
    // The ack echoes the frame's own id, so the writer can tell which of its
    // writes this decision belongs to.
    expect(steerAcks(report)).toEqual([{ id: "steer-1", accepted: true }]);
  });

  // A dsh that refuses the injection has to be reported as refused. The frame
  // was read and the write to the pipe succeeded, so only the runner knows the
  // text never reached the turn — this is the case the ack exists for.
  it("refuses a steer the live turn would not take, instead of claiming delivery", async () => {
    const report = await drive({
      scenario: "ok",
      followupDelayMs: 400,
      steerLines: ['{"type":"steer","id":"steer-1","text":"steer-refused-text"}'],
      steerRefusal: "the agent is no longer accepting steering input",
    });

    expect(report.steered).toEqual([]);
    expect(report.stderr).toContain("dsh refused the steer: the agent is no longer accepting steering input");
    expect(steerAcks(report)).toEqual([{
      id: "steer-1",
      accepted: false,
      reason: "dsh refused the steer: the agent is no longer accepting steering input",
    }]);
  });

  // Stdin is also where noise lands: a line that is not a steer frame must
  // degrade to a stderr note, never crash the turn it shares a pipe with.
  it("notes a malformed stdin frame and keeps the turn alive", async () => {
    const report = await drive({
      scenario: "ok",
      followupDelayMs: 400,
      steerLines: ["not json at all", '{"type":"steer","id":"steer-2","text":"steer-after-noise"}'],
    });

    expect(report.stderr).toContain("dropping malformed steer frame: not json at all");
    expect(report.steered).toEqual(["steer-after-noise"]);
    // The surviving frame still gets its ack: one bad line must not silence the
    // channel the next good one is waiting on.
    expect(steerAcks(report)).toEqual([{ id: "steer-2", accepted: true }]);
  });

  // After the turn ends the runner stops delivering: a frame that missed the
  // turn is noted and answered as refused instead of queued, because queueing
  // would only lie about when the model sees it — and the reader stays open, so
  // the writing side never sees EPIPE.
  it("refuses a frame that arrives after the turn and keeps reading", async () => {
    const report = await drive({
      scenario: "ok",
      resumeSessionId: RESUME_ID,
      holdOpenMs: 300,
      steerLines: ['{"type":"steer","id":"steer-late","text":"steer-after-turn"}'],
    });

    // The frame was written while the fake host was already past run(); the
    // runner's reader is in its draining state, so nothing took the text.
    expect(report.steered).toEqual([]);
    expect(report.stderr).toContain("steer arrived after the turn ended, dropped: steer-after-turn");
    expect(steerAcks(report)).toEqual([{
      id: "steer-late",
      accepted: false,
      reason: "the dsh turn had already ended, so the steer was dropped",
    }]);
  });

  // The window between the turn ending and the runner noticing. The real
  // Agent reports the transition synchronously on agent/status, so a frame
  // that lands in that instant is already known to have no turn to join -
  // while the awaited turn promise resumes only on a later microtask.
  // Delivering there would hand the text to an idle driver, and Agent.steer on
  // an idle driver STARTS A TURN: the model would answer a steer Piano never
  // submitted, and the ack would report it delivered.
  it("refuses a frame that lands the instant the turn ends", async () => {
    const report = await drive({
      scenario: "ok",
      resumeSessionId: RESUME_ID,
      followupDelayMs: 300,
      // Written mid-turn but held until the fake reports the idle transition,
      // which is the exact boundary under test rather than the settled state
      // afterwards.
      steerLines: ['{"type":"steer","id":"steer-edge","text":"edge-of-turn"}'],
      steerAtTurnEnd: true,
    });

    expect(report.steered).toEqual([]);
    expect(steerAcks(report)).toEqual([{
      id: "steer-edge",
      accepted: false,
      reason: "the dsh turn had already ended, so the steer was dropped",
    }]);
  });
});
