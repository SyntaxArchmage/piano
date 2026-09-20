/**
 * Piano's replacement for `@deepseek-ai/dsh-headless`'s one-shot runner.
 *
 * This file is Node ESM, not part of the TypeScript program: the dsh launcher
 * imports it inside its own process, where nothing compiles `.ts`. Piano writes
 * it into the dsh home it owns and overlays it with `--patch`, so a Piano dsh run
 * drives the session itself.
 *
 * Why an overlay at all: the shipped runner hardcodes
 * `SessionId(\`session-${randomUUID()}\`)`, so every epoch of a Piano actor
 * arrives at dsh as a stranger. The actor's turn count climbs in `resume.json`
 * while dsh opens yet another conversation, and the previous one — persisted,
 * complete, and reachable — is never read again. The platform has the ability:
 * the core `AgentRegistry` exposes `resume({ resumeSessionId })`, and the base
 * bundle already mounts session persistence and its query index. Only this app
 * never exposes it, and the headless app is the one surface Piano can drive.
 *
 * Structure is deliberately identical to the shipped runner — same injected
 * services, same task config, same summary, same exit codes — so the only new
 * behaviour is which session the turn runs on.
 *
 * Capability detection happens at runtime rather than by version check: an
 * installed dsh whose registry has no `resume`, or whose storage no longer holds
 * the session, falls back to a fresh session with a note on stderr instead of
 * failing the run. The fallback is a real degradation — that turn loses the
 * conversation — so it is reported rather than hidden.
 *
 * @module piano-dsh-resume-runner
 */
import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";

/** Stable Cordis plugin name. */
const name = "piano-resume-runner";

/** Core services required before the one-shot turn can start. */
const inject = ["agentDefaultModel", "agents", "sessions"];

export const Config = z.object({ task: z.string().required() });

/** Every note goes to stderr: stdout is the answer Piano reads back, and Piano
 * surfaces stderr as an observable event, so the notes land in the run's log
 * rather than in a discarded pipe. */
function note(message) {
  process.stderr.write(`dsh: ${message}\n`);
}

/** The session to continue, handed over by Piano as an environment reference
 * because the app's own argument parsing belongs to the shipped startup row. */
function resumableSessionId() {
  const value = process.env.PIANO_DSH_RESUME_SESSION;
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(events, firstSeq) {
  let started = false;
  let text = "";
  let reason;
  for (const event of events) {
    if (event.seq < firstSeq) continue;
    if (event.type === "turn/start") {
      started = true;
      continue;
    }
    if (!started) continue;
    if (event.type === "assistant/message") {
      const joined = event.data.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (joined !== "") text = joined;
    }
    if (event.type === "turn/end") reason = event.data.reason;
  }
  return { text, reason };
}

/** Text blocks of a message event, for the diagnostic history line. Durable
 * event shapes differ (`user/message` carries `data.content`,
 * `assistant/message` carries `data.message.content`). */
function eventText(event) {
  const content = event.data?.content ?? event.data?.message?.content;
  return Array.isArray(content)
    ? content.filter((block) => block.type === "text").map((block) => block.text).join("")
    : "";
}

/** Reopen the actor's conversation, or open one when there is nothing to
 * reopen. `agentOptions` and the model-selection setup are supplied on both
 * paths, so a resumed turn answers with the model this run was configured for
 * rather than whichever one the session was first created with.
 *
 * `setup` returns nothing, like the shipped runner's. The agent loop treats its
 * return value as an optional publication transaction and calls `.commit()` on
 * it, so handing back the model-selection handle instead fails the mount with
 * "commit is not a function". */
async function openAgent(agents, defaultModel) {
  const selection = defaultModel.currentSelection();
  const agentOptions = { provider: selection.provider, model: selection.model };
  const setup = (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: undefined });
  };
  const resumeId = resumableSessionId();

  if (resumeId !== undefined) {
    // Piano named the conversation this turn continues. Opening a fresh session
    // instead would run the stage with none of its memory while the run's
    // records still claimed continuity, so an unresumable request fails the
    // turn: the exit code is the only signal Piano turns into a stage failure at
    // all. Piano's retry boundary treats this as retryable, so storage that is
    // only briefly unavailable still recovers, while a session that is really
    // gone stops the run instead of silently resetting the actor.
    if (typeof agents.resume !== "function") {
      throw new Error(`piano-resume-runner: the installed dsh cannot resume ${resumeId}`);
    }
    try {
      const { agent } = await agents.resume({
        resumeSessionId: SessionId(resumeId),
        agentOptions,
        setup,
      });
      note(`resumed ${agent.id}`);
      return agent;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`piano-resume-runner: could not resume ${resumeId}: ${reason}`);
    }
  }

  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions,
    setup,
  });
  note(`new session ${agent.id}`);
  return agent;
}

/** Run one task through the actor's agent and request process exit. */
async function run(ctx, task, io) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return;

  const agent = await openAgent(agents, defaultModel);
  await agent.whenIdle();

  const history = agent.session.events
    .filter((event) => event.type === "user/message")
    .map((event) => eventText(event));
  note(`context: ${agent.session.events.length} events, ${history.length} user messages`);

  const firstSeq = agent.session.seq;
  agent.followup(createUserMessage({
    content: [{ type: "text", text: task }],
    source: { kind: "user" },
  }));
  await agent.whenIdle();
  await sessions.flush(agent.session);

  const outcome = summarize(agent.session.events, firstSeq);
  io.stdout.write(`${outcome.text}\n`);
  if (outcome.reason?.kind === "error") {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`);
  }
  io.exit(outcome.reason?.kind === "completed" ? 0 : 1);
}

/** Mount the resume runner in place of the shipped one. */
export function apply(ctx, config) {
  const exit = ctx.get("appExit");
  if (exit === undefined) throw new Error("piano-resume-runner: the launcher must provide ctx.appExit before the tree mounts");
  const io = { stdout: process.stdout, stderr: process.stderr, exit };
  run(ctx, config.task, io).catch((error) => {
    io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  });
}

export { inject, name };
