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

const calls = { resume: [], create: [], installModelSelection: [], flushed: 0 };
globalThis.__dshCalls = calls;

let stdout = "";
let stderr = "";
const realStdout = process.stdout.write.bind(process.stdout);
const realStderr = process.stderr.write.bind(process.stderr);
process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
process.stderr.write = (chunk) => { stderr += String(chunk); return true; };

function userText(event) {
  const content = event.data && (event.data.content || (event.data.message && event.data.message.content));
  return Array.isArray(content)
    ? content.filter((block) => block.type === "text").map((block) => block.text).join("")
    : "";
}

// The stand-in model loop. It answers from its own session's history, so the
// code word is reachable only through a session that already holds it.
function agentFor(id, history) {
  const events = history.slice();
  let seq = events.length;
  return {
    id,
    session: { get events() { return events; }, get seq() { return seq; } },
    whenIdle: async () => {},
    followup: (message) => {
      const seen = events.map(userText).join("\\n");
      const answer = seen.includes(codeWord) ? codeWord : "I do not know any code word";
      events.push({ seq: seq++, type: "turn/start", data: {} });
      events.push({ seq: seq++, type: "user/message", data: message });
      events.push({ seq: seq++, type: "assistant/message", data: { message: { content: [{ type: "text", text: answer }] } } });
      events.push({ seq: seq++, type: "turn/end", data: { reason: turnEnd } });
    },
  };
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
const ctx = { get: (name) => services[name] };

apply(ctx, { task: "What code word did I ask you to remember? Reply with the code word only." });

const timer = setTimeout(() => { calls.timedOut = true; finish(); }, 5000);
await done;
clearTimeout(timer);

process.stdout.write = realStdout;
process.stderr.write = realStderr;
writeFileSync(process.env.PIANO_FAKE_REPORT, JSON.stringify(Object.assign({}, calls, { stdout, stderr }), null, 2));
realStderr(stderr);
realStdout(stdout);
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
  readonly flushed: number;
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
}

/** Run the shipped plugin in a child process against the stub tree, and report
 * everything it did. `resumeSessionId` is what Piano would pass when the actor has
 * a session to reopen; omitting it is a first turn. */
async function drive(options: {
  readonly scenario: "ok" | "throws" | "absent" | "errors";
  readonly resumeSessionId?: string;
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

    const exit = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, "host.mjs")], {
        cwd: root,
        env: {
          ...process.env,
          PIANO_FAKE_SCENARIO: options.scenario,
          PIANO_FAKE_CODEWORD: CODE_WORD,
          PIANO_FAKE_REPORT: reportPath,
          ...(options.resumeSessionId === undefined ? {} : {
            PIANO_FAKE_RESUME_ID: options.resumeSessionId,
            [DSH_RESUME_SESSION_ENV]: options.resumeSessionId,
          }),
        },
      });
      child.once("error", reject);
      child.once("close", resolve);
    });

    const report = JSON.parse(await readFile(reportPath, "utf8")) as RunnerReport;
    expect(report.timedOut, "the plugin never requested an exit").toBeUndefined();
    expect(exit).toBe(0);
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

  // The plugin is standalone ESM, so it cannot import the constant Piano writes
  // the environment reference with. Assert the pairing instead of trusting it:
  // a rename on either side would otherwise leave both sides "passing" and the
  // resume silently dead.
  it("reads the environment reference the adapter writes", async () => {
    const shipped = await readFile(runnerPath, "utf8");

    expect(shipped).toContain(DSH_RESUME_SESSION_ENV);
    // And nothing that looks like a second, stale name for the same thing.
    expect(shipped.match(/PIANO_DSH_RESUME[A-Z_]*/g)?.every((name) => name === DSH_RESUME_SESSION_ENV)).toBe(true);
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
});
