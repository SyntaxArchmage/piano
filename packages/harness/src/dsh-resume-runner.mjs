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
 * services, same task config, same summary, same exit codes — so the new
 * behaviour is narrow: which session the turn runs on, and steer frames
 * delivered into it while it runs.
 *
 * Steering: for the duration of the task turn the runner reads stdin as NDJSON
 * steer frames (`{"type":"steer","text":"..."}`), the far end of Piano's
 * subprocess steering channel. Frames that arrive before the turn starts
 * survive in the stdin pipe buffer and are delivered once the reader is armed;
 * frames after it ends are
 * noted and dropped — there is no next turn to hand them to, and queueing them
 * would only lie about when the model sees them. Delivery is `Agent.steer`, the
 * core loop's next-step inbox entry, so the text joins the running turn like a
 * user interjection instead of opening a new one.
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
import { createInterface } from "node:readline";
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

/** Read one immutable event interval through dsh's current Session API.
 * The legacy `events` array remains a compatibility fallback for older dsh
 * installations, but current sessions expose only `snapshotEvents()`. */
function snapshotEvents(session, fromSeq = 0, toSeqExclusive = session.seq) {
  if (typeof session.snapshotEvents === "function") {
    return session.snapshotEvents(fromSeq, toSeqExclusive);
  }
  if (Array.isArray(session.events)) {
    return session.events.slice(fromSeq, toSeqExclusive);
  }
  throw new Error("piano-resume-runner: the installed dsh exposes no readable session event API");
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(session, firstSeq) {
  let started = false;
  let text = "";
  let reason;
  for (const event of snapshotEvents(session, firstSeq)) {
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

/** One steer frame read from stdin. A line that is not a steer frame is noted
 * and skipped rather than crashing the turn: the far end owns the protocol, and
 * a stray write must degrade to a log line, not a lost turn.
 *
 * The frame's `id` is echoed back in the ack so Piano can tell which of its
 * writes this decision belongs to. */
function steerFrame(line) {
  if (line.trim() === "") return undefined;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    note(`dropping malformed steer frame: ${line.slice(0, 80)}`);
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || parsed.type !== "steer" || typeof parsed.text !== "string") {
    note(`dropping unknown stdin frame: ${line.slice(0, 80)}`);
    return undefined;
  }
  return {
    text: parsed.text,
    ...(typeof parsed.id === "string" ? { id: parsed.id } : {}),
  };
}

/** Answer one steer frame on the ack channel. Piano only reports a steer as
 * delivered when a live turn actually took it, so a refusal is stated in the
 * same terms Piano's own channel uses — `accepted: false` is its
 * "no-active-turn", not a quiet success. The ack rides stderr because stdout
 * carries the turn's answer. */
function ackSteer(id, accepted, reason) {
  if (id === undefined) return;
  process.stderr.write(`piano-steer:${JSON.stringify({
    id,
    accepted,
    ...(reason === undefined ? {} : { reason }),
  })}\n`);
}

/** Announced on stderr once stdin is genuinely being read, so the far end can
 * know its frames will be seen instead of assuming the pipe buffered them.
 * Reading starts here rather than at process start: `run()` awaits the loader
 * and the session before it gets this far, and a frame written in that window
 * is only kept by luck of pipe buffering — a stream that has not been attached
 * yet is not obliged to hold what arrives. */
const STEERING_READY = "steering ready";

/** Read stdin as NDJSON steer frames. Before the turn is armed the frames
 * queue — the channel binds as soon as the child spawns, which can be well
 * before the agent loop starts the task, and a frame that arrived that early is
 * still destined for this turn. While armed, frames are handed to `deliver`
 * immediately. After disarm the reader stays open until process exit in a
 * draining state, so a frame that missed the turn gets its honest note instead
 * of an EPIPE on the writing side.
 *
 * Whether the turn is live is read from `isLive`, asked at the moment each
 * frame arrives. The alternative — arming at the task's start and disarming
 * after `whenIdle()` resolves — leaves a window between the turn really ending
 * and the promise's callback running, and a frame landing there is not merely
 * misfiled: `Agent.steer` on an idle driver *starts a turn*, so the text would
 * be answered in a turn Piano never submitted, and it would be acked delivered.
 * `isLive` has no such window because it asks the agent's own state rather than
 * the timing of a promise. */
function openSteeringInput(isLive) {
  const queued = [];
  let accepting = true;
  let deliver;
  const input = createInterface({ input: process.stdin, terminal: false });
  // The reader must not hold the process open. dsh's launcher requests exit
  // through a graceful shutdown: disposal completes, `process.exitCode` is
  // set, and the process ends once the event loop drains — it never
  // hard-exits from appExit. An attached stdin reader keeps the loop alive
  // for as long as the far end holds the pipe open, which after the turn
  // would be forever: the runner would print its answer and then hang the
  // exit it just requested. `unref` keeps the reader honest (late frames are
  // still consumed and answered while anything else holds the loop) without
  // letting it hold the exit. The shipped runner never reads stdin and so
  // never had to say this. (The unref belongs to the stream, not to the
  // readline Interface — the Interface has no unref of its own.)
  process.stdin.unref?.();
  input.on("line", (line) => {
    const frame = steerFrame(line);
    if (frame === undefined) return;
    // Asked per frame, not once: the turn can end between two frames on the
    // same pipe, and each frame's answer must be about its own moment.
    if (deliver !== undefined && isLive()) {
      deliver(frame);
      return;
    }
    if (accepting) {
      queued.push(frame);
      note(`steer buffered (${queued.length}): ${frame.text.slice(0, 80)}`);
      return;
    }
    // The turn is over, so there is no next step to hand this to. Say so on the
    // ack channel: the writer is deciding whether to report this as delivered.
    note(`steer arrived after the turn ended, dropped: ${frame.text.slice(0, 80)}`);
    ackSteer(frame.id, false, "the dsh turn had already ended, so the steer was dropped");
  });
  // Announced only once the reader is attached and its handler registered: from
  // here a frame written by the far end is queued and answered, so it can stop
  // waiting and send. Before this line the frame is only kept if the pipe
  // happened to buffer it, which is a race, not a contract.
  note(STEERING_READY);
  return {
    arm(callback) {
      deliver = callback;
      for (const frame of queued.splice(0)) {
        if (isLive()) deliver(frame);
        else {
          note(`steer arrived after the turn ended, dropped: ${frame.text.slice(0, 80)}`);
          ackSteer(frame.id, false, "the dsh turn had already ended, so the steer was dropped");
        }
      }
    },
    /** Stop taking frames, by the agent's own transition out of `running`
     * rather than by the awaited turn returning. Queued frames that never found
     * a live turn are answered here, so a caller waiting on an ack is not left
     * holding a promise the runner has stopped caring about. */
    close() {
      accepting = false;
      deliver = undefined;
      for (const frame of queued.splice(0)) {
        note(`steer arrived after the turn ended, dropped: ${frame.text.slice(0, 80)}`);
        ackSteer(frame.id, false, "the dsh turn had already ended, so the steer was dropped");
      }
    },
  };
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

/** Run one task through the actor's agent and request process exit. Steer
 * frames read from stdin while the task turn runs are delivered into it as
 * user interjections (`Agent.steer`); frames that arrive before the turn starts
 * are delivered the moment it is armed, and frames after it ends are noted and
 * dropped. */
async function run(ctx, task, io) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return;

  const agent = await openAgent(agents, defaultModel);
  await agent.whenIdle();

  const events = snapshotEvents(agent.session);
  const history = events
    .filter((event) => event.type === "user/message")
    .map((event) => eventText(event));
  note(`context: ${events.length} events, ${history.length} user messages`);

  const firstSeq = agent.session.seq;
  // The turn this runner owns, by the agent's own lifecycle. `status` is
  // `'idle' | 'running'`, and the transition is synchronous in both directions
  // ("A waking delivery enters `running` synchronously after reserving
  // cancellation; `idle` means no driver remains scheduled or active"), so
  // asking it at the moment a frame arrives has no window to lose. `followup()`
  // moves the agent out of idle synchronously, so the task turn is `running`
  // from the line below on.
  //
  // Ownership matters as much as liveness: a steer delivered to an idle driver
  // starts a turn of its own, and that turn is NOT the one Piano submitted. If
  // liveness were just "the agent is running", a frame arriving after the task
  // turn ended but before the reader noticed would open a fresh turn, be acked
  // as delivered, and let the *next* frame continue an answer nobody asked for.
  // The window closes when this runner's own turn is over, whatever the agent
  // is doing afterwards.
  // Load-bearing window: between this attach and steering.arm() below there is
  // deliberately NO await — readline delivers nothing until the stack unwinds,
  // so every frame reaches the armed live path and openSteeringInput's pre-arm
  // queue stays unreachable. Inserting an await here reopens that queue path,
  // which no test pins (its former test was pruned as structurally
  // unreachable); re-pin the buffering behaviour before adding one.
  let armed = false;
  const steering = openSteeringInput(() => armed && agent.status === "running");
  const onStatus = ({ agent: changed, status }) => {
    if (changed !== agent) return;
    if (status === "idle") {
      // The agent's own state is the criterion the frame check reads, so this
      // is only about stopping the reader promptly and answering anything
      // still queued. Both are safe to be late: a late frame is refused by the
      // status check above regardless.
      armed = false;
      steering.close();
      return;
    }
    note(`turn live`);
  };
  // Subscribe the way dsh's own invariant plugin does: `{ global: true }`
  // receives the event regardless of context-filter checks, so delivery does
  // not depend on how this runner's fiber happens to sit relative to the
  // agent's scope. `agent/status` carries the agent it moved, and the payload
  // filter above is what keeps a sibling agent's transitions out of this run.
  // `ctx.on` returns a disposer (Cordis has no `ctx.off`), held for the end of
  // the turn.
  const disposeStatus = ctx.on("agent/status", onStatus, { global: true });
  const deliverSteer = (frame) => {
    try {
      agent.steer(createUserMessage({ content: [{ type: "text", text: frame.text }], source: { kind: "user" } }));
      note(`steer delivered: ${frame.text.slice(0, 80)}`);
      ackSteer(frame.id, true);
    } catch (error) {
      const reason = `dsh refused the steer: ${error instanceof Error ? error.message : String(error)}`;
      note(reason);
      ackSteer(frame.id, false, reason);
    }
  };
  agent.followup(createUserMessage({
    content: [{ type: "text", text: task }],
    source: { kind: "user" },
  }));
  // followup() synchronously moves the agent out of idle, so every frame that
  // reached the process after this point belongs to the live turn — arming
  // here cannot open a premature turn behind the task. `armed` only says this
  // runner has a turn of its own to steer; whether that turn is still running
  // is asked of the agent each time, so a frame landing exactly on the
  // transition cannot slip through between a flag being set and the listener
  // that clears it running.
  armed = true;
  steering.arm(deliverSteer);
  await agent.whenIdle();
  // The turn is over: `agent/status` said so, and `whenIdle()` resolving is the
  // same fact from the other side. Confirm it here so a run whose status event
  // was somehow missed still stops accepting.
  steering.close();
  disposeStatus();
  await sessions.flush(agent.session);

  const outcome = summarize(agent.session, firstSeq);
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
