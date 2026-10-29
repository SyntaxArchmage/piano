// One live session's replay loop: turns a prompt/TUI event into a workflow run
// and persists the trajectory, writing the headless result to stdout when a
// prompt was supplied. Extracted from main.ts so both the default entrypoint
// and `resume` can drive the same loop without a circular import.

import { NodeFileSystem } from "@effect/platform-node";
import { FileSystem } from "@effect/platform";
import { Effect, Exit } from "effect";
import { stderr, stdout } from "node:process";
import { dirname } from "node:path";
import {
  createSession,
  failureDetails,
  isCancellation,
  Logging,
  loggingService,
  logger,
  TRACE,
  type LoggingError,
  type LoggingService,
  type Session,
  type Source,
  type StagingSession,
  type TrajectoryWriteInput,
} from "@piano/logging";
import {
  compileWorkflow,
  builtinWorkflowSelection,
  executeWorkflow,
  EXPLICIT_LOAD_SOURCE,
  LOAD_SOURCE,
  loadDefaultWorkflow,
  loadWorkflow,
  mnemonicNamespace,
  readWorkflowExecutionContinuation,
  readRunStatus,
  reconcileCrashedRun,
  refreshRunStatus,
  runStatusPath,
  setWorkflowSelection,
  type LoadedWorkflow,
  type WorkflowExecutionError,
  WorkflowError,
  type WorkflowSignoffDecision,
  type WorkflowSignoffRequest,
  type WorkflowDiscussDecision,
  type WorkflowDiscussRequest,
} from "@piano/orchestrator";
import {
  createLangfuseExport,
  resolveLangfuseConfig,
  type LangfuseExport,
} from "@piano/langfuse";
import {
  appendJsonlLine,
  fanoutObservationOps,
  observationStreamSink,
  withoutDeltas,
  type ObservationOpSink,
} from "@piano/logging";
import { observationStreamPath } from "@piano/base";
import { mapWorkflowObservation } from "@piano/langfuse";
import type { WorkflowObservation } from "@piano/trajectory";
import {
  agentEventExporter,
  createSteeringChannel,
  executeAgent,
  prepareHarnessHomes,
  probeDshResumeCapability,
  resolveHarnessConfig,
  type AgentContinuation,
  type AgentEvent,
  type AgentHarnessOptions,
  type AgentRunner,
  type SteeringChannel,
  HarnessHomeError,
} from "@piano/harness";
import type { Terminal } from "@earendil-works/pi-tui";
import { runTui, type TuiResumeResult, type TuiScreenKind } from "./tui.js";
import { headlessSignoffChannel } from "./signoff.js";
import { headlessDiscussChannel } from "./discuss.js";
import { sideAgentRequest } from "./side-agent.js";
import { summarizeTaskMnemonic } from "./task-mnemonic.js";
import {
  agentEventLine,
  completedLine,
  failedLine,
  observationOpLine,
  serializeLine,
  startedLine,
} from "./headless-json.js";
import type { CliError } from "./errors.js";
import { programName } from "./program-name.js";
import { readResumeContext } from "./session-resume.js";
import {
  resolveContinueCommand,
  resolveRestartCommand,
} from "./job-commands.js";
import { armStalledExitGuard } from "./stalled-exit.js";
import type { WorkflowGraphDefinition } from "./workflow-graph.js";

const SESSION_SOURCE: Source = { module: "cli", file: "session-run.ts", function: "runSession" };
const TUI_SOURCE: Source = { module: "cli", file: "tui.ts", function: "runTui" };
const INPUT_SOURCE: Source = { module: "cli", file: "session-run.ts", function: "runPrompt" };
const SESSION_LOG = logger(SESSION_SOURCE, { namespace: "cli" });
const TUI_LOG = logger(TUI_SOURCE, { namespace: "cli" });
const INPUT_LOG = logger(INPUT_SOURCE, { namespace: "cli" });

export type SessionRunError = CliError | LoggingError | WorkflowExecutionError | HarnessHomeError;

export interface SessionRunOptions {
  readonly workflowPath?: string;
  readonly prompt?: string;
  readonly json?: boolean;
  /** Task namespace for lane branches; skips the preflight summary. */
  readonly mnemonic?: string;
  /** Switch the trajectory surface onto the Langfuse-aligned `ObservationOp`
   * vocabulary: write `system-log/observations.jsonl`, feed the TUI ledger from
   * ops, and put `observation_op` on the `--json` wire. `AgentEvent` keeps
   * working and stays the default; this is the migration switch, not a
   * replacement. */
  readonly langfuse?: boolean;
  /** Resume this run as soon as the TUI opens. When it is the session's own run,
   * the takeover reuses the open session instead of opening a second one. */
  readonly resumeRunId?: string;
  /** Open the resume picker as soon as the TUI opens. */
  readonly resumePicker?: boolean;
  /** Mission-scoped native harness environment. The parent process never
   * mutates its own Claude/dsh configuration. */
  readonly agentOptions?: AgentHarnessOptions;
  /** Inject the harness agent adapter (tests) — production uses the real
   * executeAgent/configured adapter. Deterministic session tests mock "sending
   * the prompt" here while the real engine, session loop and TUI run. */
  readonly agentRunner?: AgentRunner;
  /** Drive the interactive TUI on an injected terminal (tests) instead of the
   * process terminal, so a scripted terminal can type into a real session. */
  readonly terminal?: Terminal;
}

/** Flatten a compiled stage's model declaration for the footer's graph. The
 * graph draws stages, not lanes, so a per-lane model list has no lane to index
 * and is joined instead — the lane each entry belongs to is the run's to report
 * once it schedules one. */
function graphModelLabel(model: string | readonly string[] | undefined): string | undefined {
  if (model === undefined) return undefined;
  return typeof model === "string" ? model : model.join(" · ");
}

/** Compile a loaded workflow into the read-only shape the status footer draws.
 * Shared by startup, `/workflow`, and `/resume`, which all change what the
 * footer should be tracking. */
function graphOf(workflow: LoadedWorkflow) {
  return compileWorkflow(workflow.document, workflow.workflowPath).pipe(
    Effect.map((compiled): WorkflowGraphDefinition => ({
      name: compiled.name,
      path: workflow.workflowPath,
      stages: compiled.stages.map((stage) => ({
        id: stage.id,
        dependsOn: stage.dependsOn,
        model: graphModelLabel(stage.stage.model),
      })),
      maps: compiled.regions
        .filter((region) => region.kind === "map" && region.count !== undefined)
        .map((region) => ({
          id: region.id,
          entryStageId: region.entryStageId,
          exitStageId: region.exitStageId,
          count: region.count ?? 0,
        })),
    })),
  );
}

/** Build the opt-in Langfuse export pair for one run, or undefined when export
 * is not configured. Local evidence is unaffected either way. */
function langfuseExportFor(
  runId: string,
): Effect.Effect<LangfuseExport | undefined, never, never> {
  return Effect.promise(async () => {
    const config = resolveLangfuseConfig(process.env);
    if (config === undefined) return undefined;
    return createLangfuseExport(runId, config);
  });
}

/** The one writer for a run's observation stream.
 *
 * Ordering is a property of the file, not of a caller: a batch that overtakes
 * the one before it leaves an `end` ahead of its `start`, and the fold drops
 * both. The mission and the side agent share one writer per run, so their
 * facts cannot interleave either. This is the run's only fire-and-forget
 * stream — the other writers hand back an `Effect` the caller awaits, so they
 * order themselves — which is why the chain lives here. */
export function observationWriter(
  observationPath: string,
  fileSystem: FileSystem.FileSystem,
): { readonly append: (lines: string) => void; readonly flush: () => Promise<void> } {
  let writes: Promise<unknown> = Promise.resolve();
  // One write failing must not poison the chain: the next batch still reaches
  // the file. A gap is an evidence gap, never a run failure.
  const settled = (): Promise<void> => writes.then(() => undefined, () => undefined);
  return {
    append: (lines) => {
      writes = settled().then(() => Effect.runPromise(
        appendJsonlLine(fileSystem, observationPath, lines, () => undefined).pipe(Effect.ignore),
      ));
    },
    flush: () => settled(),
  };
}

/** The op sinks one run fans out to, plus the flush that makes its evidence
 * durable. Shared by the workflow path and the side agent so the two cannot
 * disagree on what is written where. Evidence sinks drop `update` ops (the
 * chat's delta stream); display sinks keep them. */
function opsSinks(input: {
  readonly runId: string;
  readonly writer: ReturnType<typeof observationWriter>;
  readonly langfuse: boolean;
  readonly json: boolean;
  /** The conversation whose screen these ops draw on. */
  readonly screen: TuiScreenKind;
  readonly panelSinks: Readonly<Partial<Record<TuiScreenKind, ObservationOpSink>>>;
  readonly langfuseExport: LangfuseExport | undefined;
}): { readonly sinks: ObservationOpSink[]; readonly flush: () => Promise<void> } {
  const { runId, writer, langfuse, json, screen, panelSinks, langfuseExport } = input;
  const sinks: ObservationOpSink[] = [];
  if (langfuse) {
    sinks.push((ops) => panelSinks[screen]?.(ops));
    sinks.push(withoutDeltas(observationStreamSink(writer.append)));
    // Headless automation reads the same ops on stdout, so the `--json` stream
    // can move to the new vocabulary without waiting for the run directory to
    // be inspected.
    if (json) {
      sinks.push(withoutDeltas(observationStreamSink(
        (lines) => stdout.write(lines),
        (op) => serializeLine(observationOpLine(op, runId)),
      )));
    }
  }
  if (langfuseExport !== undefined) sinks.push(withoutDeltas(langfuseExport.onOps));
  return {
    sinks,
    flush: async () => {
      await writer.flush();
      await langfuseExport?.flush();
    },
  };
}

/** Turn a live logging session into a replay loop: run the headless prompt or
 * open the TUI, and persist each completed prompt's trajectory. */
function runSessionBody(
  session: Session | StagingSession,
  options: SessionRunOptions,
): Effect.Effect<void, SessionRunError, import("@effect/platform").FileSystem.FileSystem> {
  const logging = loggingService(session.log, session.trace);
  // A staging session materialises its run directory at the first prompt; a
  // non-staging session already has one. Both reach the same `runPrompt` path.
  const commitSession = "commit" in session
    ? (prompt: string) => session.commit().pipe(
      Effect.tap(() => SESSION_LOG.info("run.created", {
        data: { runDir: session.runDir, promptLength: prompt.length },
      })),
    )
    : undefined;
  return Effect.gen(function* () {
    // Each TUI screen registers its own fused-op display sink when `--langfuse`
    // is on; the per-prompt fanout reaches the one for the conversation it is
    // writing, so the mission and `/btw` never draw each other's turns.
    const panelSinks: Partial<Record<TuiScreenKind, ObservationOpSink>> = {};
    // One writer per observation stream: the mission and the side agent write
    // the same run's file and their batches must not overtake each other.
    const writers = new Map<string, ReturnType<typeof observationWriter>>();
    const writerFor = (path: string, fileSystem: FileSystem.FileSystem) => {
      const existing = writers.get(path);
      if (existing !== undefined) return existing;
      const writer = observationWriter(path, fileSystem);
      writers.set(path, writer);
      return writer;
    };
    const initialWorkflow = yield* TRACE(
      options.workflowPath === undefined ? LOAD_SOURCE : EXPLICIT_LOAD_SOURCE,
      options.workflowPath === undefined
        ? loadDefaultWorkflow(session.root)
        : loadWorkflow(options.workflowPath, session.root),
      {
        root: session.root,
        ...(options.workflowPath === undefined ? {} : { workflowPath: options.workflowPath }),
      },
    ).pipe(Effect.either);
    // An explicit workflow path is an assertion by the caller. Do not open a
    // generic TUI when that file is missing or malformed: the empty shell
    // hides the actionable load error and makes the requested workflow appear
    // to have been ignored.
    if (options.workflowPath !== undefined && initialWorkflow._tag === "Left") {
      return yield* Effect.fail(initialWorkflow.left);
    }
    let loadedWorkflow = initialWorkflow._tag === "Right" ? initialWorkflow.right : undefined;
    let initialWorkflowFailure = initialWorkflow._tag === "Left" ? initialWorkflow.left : undefined;
    /** The live turn's abort handle and steering channel, one slot per screen.
     * `/btw` leaves the run working while the side agent owns the foreground, so
     * a single slot would make Escape and mid-turn steering hit whichever turn
     * registered last instead of the one the developer is looking at. */
    const controllers: Partial<Record<TuiScreenKind, AbortController>> = {};
    const steerings: Partial<Record<TuiScreenKind, SteeringChannel>> = {};
    let activeCwd = session.cwd;
    // The run this loop currently writes to. `/resume` swaps it in place, so
    // every prompt-scoped write (trajectory, log, trace, run directory) must be
    // read from here rather than captured from the outer `session`.
    let active: {
      session: Session;
      logging: LoggingService;
      /** Present only while the session is still staging. */
      commit?: (prompt: string) => Effect.Effect<void, LoggingError, import("@effect/platform").FileSystem.FileSystem | Logging>;
    } = { session, logging, ...(commitSession === undefined ? {} : { commit: commitSession }) };
    const runsRoot = dirname(session.runDir);
    yield* TRACE(SESSION_SOURCE, Effect.gen(function* () {
      yield* SESSION_LOG.info("cli.started", {
        data: {
          command: programName(),
          ...(options.workflowPath === undefined ? {} : { workflowPath: options.workflowPath }),
        },
      });
      // Headless runs have no reviewer: the sign-off gate is auto-approved
      // (see headlessSignoffChannel) so the single prompt reaches its terminal
      // state and the process exits without waiting on any interaction. The
      // TUI passes its own channel (an overlay on the live TUI) instead.
      const headlessSignoff = headlessSignoffChannel();
      const headlessDiscuss = headlessDiscussChannel();
      /** A refused job command is a user-facing answer, not a crash: the
       * message says what to do instead, and it lands in the transcript the
       * same way a failure would. */
      const jobCommandRefused = (command: string, runDir: string, reason: string) =>
        new WorkflowError({ phase: "schedule", path: runDir, message: `/${command} is unavailable: ${reason}` });
      const runPrompt = (
        prompt: string,
        onEvent: (event: AgentEvent) => void,
        signoff: (request: WorkflowSignoffRequest) => Effect.Effect<WorkflowSignoffDecision, WorkflowError> = headlessSignoff,
        discuss: (request: WorkflowDiscussRequest) => Effect.Effect<WorkflowDiscussDecision, WorkflowError> = headlessDiscuss,
        jobCommand?: "continue" | "restart",
      ) => {
        const controller = new AbortController();
        controllers.mission = controller;
        // One steering channel per prompt: whichever worker session comes to
        // life during this prompt binds it (harness-side); the TUI pushes
        // mid-turn text through `steerActive` below.
        const steering = createSteeringChannel();
        steerings.mission = steering;
        // Pin the run for this prompt's whole lifetime: a `/resume` accepted
        // mid-flight must not redirect a running prompt's evidence.
        const current = active;
        const workflow = loadedWorkflow;
        const events: AgentEvent[] = [];
        /** The input actually run. A job command resolves its own from the
         * recorded turns, and the trajectory turn must carry that text — not
         * the command's spelling. */
        let effectivePrompt = prompt;
        // A staging session materialises its run directory here — the first
        // prompt is the moment the run becomes real. Later prompts see a
        // committed session and take the direct path.
        const beginRun = current.commit === undefined
          ? Effect.void
          : current.commit(prompt);
        const persistTrajectory = (document: TrajectoryWriteInput) =>
          current.session.trajectory.write(document).pipe(
            Effect.zipRight(refreshRunStatus(current.session.runDir)),
            Effect.tapError((error) => Effect.sync(() => {
              // A trajectory is supplementary evidence and must not replace
              // the worker result, but persistence failures must remain
              // visible instead of being silently swallowed.
              stderr.write(`observability write failed: ${error.message}\n`);
            })),
            Effect.ignore,
          );
        /** Fields every turn re-asserts, so the newest values win on resume. */
        const context = {
          promptLength: prompt.length,
          events,
          workspaceCwd: activeCwd,
          ...(workflow === undefined ? {} : { workflowPath: workflow.workflowPath }),
        };
        return TRACE(INPUT_SOURCE, INPUT_LOG.info("input.accepted", {
          data: { promptLength: prompt.length },
        }).pipe(
          // A staging session has no durable run directory until commit finishes.
          // Keep this tiny startup barrier uninterruptible: `/exit` can arrive
          // immediately after Enter, and interrupting here would close the TUI
          // before the cancelled turn has anywhere to persist its trajectory.
          // The workflow itself remains interruptible and observes the pending
          // cancellation as soon as the commit completes.
          Effect.andThen(Effect.uninterruptible(beginRun)),
          Effect.andThen(workflow === undefined
            ? Effect.fail(initialWorkflowFailure ?? new WorkflowError({
              phase: "load",
              path: session.root,
              message: `workflow load failed at ${session.root}: no workflow selected`,
            }))
            : Effect.gen(function* () {
              // One run is one execution: the run id is the execution id, and
              // each prompt continues the actors the previous prompts left
              // behind — `/continue` takes the identical path, only carrying
              // the paused job's cursor.
              const execution = yield* readWorkflowExecutionContinuation(current.session.runDir);
              // The lane namespace is the task's identity. A resumed run keeps
              // the one the orchestrator recorded; a new run takes --mnemonic,
              // else a preflight summary of this prompt, else the workflow's
              // own mnemonic. An injected runner owns the whole conversation,
              // so it also owns naming: pass --mnemonic instead of relying on
              // the summary.
              const allowSummary = options.agentRunner === undefined;
              const langfuseExport = yield* langfuseExportFor(current.session.id);
              // One production point, several sinks: both mappers run once and
              // the same ops fan out to the local stream and to Langfuse, so the
              // two can never diverge. `AgentEvent` keeps flowing to `onEvent`;
              // under `--langfuse` the TUI panel and the headless wire read the
              // ops instead, and leave that feed unused.
              const fileSystem = yield* FileSystem.FileSystem;
              const { sinks, flush } = opsSinks({
                runId: current.session.id,
                writer: writerFor(observationStreamPath(current.session.runDir), fileSystem),
                langfuse: options.langfuse === true,
                json: options.json === true,
                screen: "mission",
                panelSinks,
                langfuseExport,
              });
              const emitOps = fanoutObservationOps(sinks);
              const now = () => new Date().toISOString();
              const observationExport = {
                id: "observation",
                export: (observation: WorkflowObservation) =>
                  Effect.sync(() => {
                    emitOps(mapWorkflowObservation(observation, now()));
                  }),
                // The orchestrator already flushes every export at
                // `closeWorkflowTrajectory`; speaking the port here is what
                // makes the mission's turn end durable without a second hook.
                flush: () => Effect.promise(flush),
              };
              const projectAgentEvent = sinks.length === 0
                ? undefined
                : agentEventExporter(emitOps);
              const request = {
                runDir: current.session.runDir,
                cwd: activeCwd,
                runId: current.session.id,
                ...(options.mnemonic === undefined
                  ? {}
                  : { mnemonic: mnemonicNamespace(options.mnemonic, current.session.id) }),
                ...(allowSummary
                  ? {
                    summarizeMnemonic: () => summarizeTaskMnemonic({
                      prompt,
                      cwd: activeCwd,
                      runDir: current.session.runDir,
                      runAgent: executeAgent,
                      ...(options.agentOptions === undefined ? {} : { options: options.agentOptions }),
                      signal: controller.signal,
                    }),
                  }
                  : {}),
                ...(execution === undefined ? {} : { execution }),
                signal: controller.signal,
                steering,
                ...(options.agentOptions === undefined ? {} : { agentOptions: options.agentOptions }),
                ...(options.agentRunner === undefined ? {} : { agentRunner: options.agentRunner }),
                signoff,
                discuss,
                ...(sinks.length === 0 ? {} : { observationExport }),
                onEvent: (event: AgentEvent) => {
                  projectAgentEvent?.(event);
                  events.push(event);
                  onEvent(event);
                },
              };
              if (jobCommand === undefined) {
                return yield* executeWorkflow(workflow, { ...request, prompt });
              }
              const runStatus = yield* readRunStatus(current.session.runDir);
              if (jobCommand === "continue") {
                const resolved = resolveContinueCommand(runStatus);
                if (resolved.kind === "refused") {
                  return yield* Effect.fail(jobCommandRefused("continue", current.session.runDir, resolved.reason));
                }
                effectivePrompt = resolved.command.input;
                return yield* executeWorkflow(workflow, {
                  ...request,
                  prompt: effectivePrompt,
                  continueJob: {
                    jobOrdinal: resolved.command.jobOrdinal,
                    accepted: resolved.command.accepted,
                    attempts: resolved.command.attempts,
                    ...(resolved.command.regions === undefined ? {} : { regions: resolved.command.regions }),
                  },
                });
              }
              const resolved = resolveRestartCommand(runStatus);
              if (resolved.kind === "refused") {
                return yield* Effect.fail(jobCommandRefused("restart", current.session.runDir, resolved.reason));
              }
              effectivePrompt = resolved.command.input;
              return yield* executeWorkflow(workflow, {
                ...request,
                prompt: effectivePrompt,
                ...(resolved.command.restartOrdinal === undefined ? {} : { restartOrdinal: resolved.command.restartOrdinal }),
              });
            }),
        ))).pipe(
          Effect.map((result) => ({
            text: result.text,
            sessionId: result.sessionId,
            transcriptPath: result.transcriptPath,
            trajectoryPath: current.session.trajectory.path,
            progressPath: result.progressPath,
            // The run's single state document replaced the progress snapshot;
            // the headless contract names it status_path.
            statusPath: runStatusPath(current.session.runDir),
          })),
          Effect.onExit((exit) => Effect.uninterruptible(
            Exit.isSuccess(exit)
            ? persistTrajectory({
              ...context,
              prompt: effectivePrompt,
              promptLength: effectivePrompt.length,
              status: "completed",
              sessionId: exit.value.sessionId,
              transcriptPath: exit.value.transcriptPath,
            })
            : persistTrajectory({
              ...context,
              prompt: effectivePrompt,
              promptLength: effectivePrompt.length,
              status: isCancellation(exit.cause) ? "cancelled" : "failed",
              error: failureDetails(exit.cause),
            }))),
          Effect.ensuring(Effect.sync(() => {
            if (controllers.mission === controller) delete controllers.mission;
            if (steerings.mission === steering) delete steerings.mission;
          })),
          Effect.provideService(Logging, current.logging),
          Effect.provide(NodeFileSystem.layer),
          // beginRun needs the same services its session commit path uses.
          Effect.provideService(Logging, logging),
        );
      };
      /** `/btw`'s side agent: one direct agent call per prompt, deliberately
       * not a workflow — a side task must not enter the mission's execution,
       * its progress ledger or its stage graph, and one TUI hosting two
       * workflows would make every piece of evidence ambiguous.
       *
       * What it does share with the mission is what the developer expects to be
       * shared: the workspace it edits, the run directory its own harness
       * session files live under, and the interrupt/steering controls (it
       * registers into the same `activeController`/`activeSteering`, so Escape
       * and mid-turn steering work with no extra wiring). It writes no
       * trajectory turn: the run's trajectory is the workflow's evidence, and a
       * side turn replayed as a workflow turn would be a lie. */
      let sideContinuation: AgentContinuation | undefined;
      const runSideAgent = (prompt: string, onEvent: (event: AgentEvent) => void) => {
        const controller = new AbortController();
        controllers.side = controller;
        const steering = createSteeringChannel();
        steerings.side = steering;
        const current = active;
        const beginRun = current.commit === undefined
          ? Effect.void
          : current.commit(prompt);
        const runAgent = options.agentRunner ?? executeAgent;
        return TRACE(INPUT_SOURCE, INPUT_LOG.info("input.accepted", {
          data: { promptLength: prompt.length, agent: "side" },
        }).pipe(
          Effect.andThen(beginRun),
          // Suspended so the turn reads the continuation left by the previous
          // one: consecutive `/btw` prompts are one conversation.
          Effect.andThen(Effect.suspend(() => Effect.gen(function* () {
            // A side turn is not a workflow, so no `stage_attempt_*` observes
            // it. Bridge its events onto the same op stream the mission uses,
            // with its own context so the two conversations cannot interleave
            // handles.
            const langfuseExport = yield* langfuseExportFor(current.session.id);
            const fileSystem = yield* FileSystem.FileSystem;
            const { sinks, flush } = opsSinks({
              runId: current.session.id,
              writer: writerFor(observationStreamPath(current.session.runDir), fileSystem),
              langfuse: options.langfuse === true,
              json: options.json === true,
              screen: "side",
              panelSinks,
              langfuseExport,
            });
            const projectAgentEvent = sinks.length === 0
              ? undefined
              : agentEventExporter(fanoutObservationOps(sinks));
            return yield* runAgent(
              sideAgentRequest({
                prompt,
                cwd: activeCwd,
                runDir: current.session.runDir,
                ...(sideContinuation === undefined ? {} : { continuation: sideContinuation }),
                signal: controller.signal,
                steering,
                onEvent: (event) => {
                  projectAgentEvent?.(event);
                  onEvent(event);
                },
              }),
              options.agentOptions ?? {},
            ).pipe(
              // No workflow trajectory owns this turn, so the session closes
              // the export itself — through the same handle the mission's
              // `WorkflowObservationExport.flush` reaches.
              Effect.onExit(() => Effect.promise(flush)),
            );
          }))),
        )).pipe(
          Effect.tap((result) => Effect.sync(() => {
            sideContinuation = result.continuation;
          })),
          Effect.map((result) => ({
            text: result.text,
            sessionId: result.sessionId,
            transcriptPath: result.transcriptPath,
          })),
          Effect.onExit((exit) => Effect.uninterruptible(
            Exit.isSuccess(exit)
            ? INPUT_LOG.info("side.completed", {
              data: { sessionId: exit.value.sessionId, textLength: exit.value.text.length },
            })
            : INPUT_LOG.error("side.failed", {
              data: {
                status: isCancellation(exit.cause) ? "cancelled" : "failed",
                error: failureDetails(exit.cause),
              },
            }))),
          Effect.ensuring(Effect.sync(() => {
            if (controllers.side === controller) delete controllers.side;
            if (steerings.side === steering) delete steerings.side;
          })),
          Effect.provideService(Logging, current.logging),
          Effect.provide(NodeFileSystem.layer),
          // beginRun needs the same services its session commit path uses.
          Effect.provideService(Logging, logging),
        );
      };
      if (options.prompt !== undefined) {
        // Under `--langfuse` the headless stream is the op vocabulary, the same
        // switch the TUI makes: `agent_event` stays the non-`--langfuse` wire.
        const onEvent = options.json && options.langfuse !== true
          ? (event: AgentEvent) => {
              stdout.write(`${serializeLine(agentEventLine(event, session.id))}\n`);
            }
          : () => {};
        const effect = runPrompt(options.prompt, onEvent);
        if (options.json) {
          stdout.write(`${serializeLine(startedLine(session.id, session.cwd))}\n`);
          const result = yield* effect.pipe(
            Effect.onExit((exit) => Effect.sync(() => {
              if (Exit.isSuccess(exit)) {
                stdout.write(`${serializeLine(completedLine(session.id, exit.value))}\n`);
              } else {
                stdout.write(`${serializeLine(failedLine(session.id, "run.failed", failureDetails(exit.cause).message))}\n`);
              }
            })),
          );
          void result;
        } else {
          const result = yield* effect;
          stdout.write(`${result.text}\n`);
        }
      } else {
        let workflowGraph: WorkflowGraphDefinition | undefined;
        if (loadedWorkflow !== undefined) {
          workflowGraph = yield* graphOf(loadedWorkflow).pipe(
            Effect.catchAll((error) => options.workflowPath === undefined
              ? TUI_LOG.warn("tui.workflow_graph_unavailable", {
                data: { error: failureDetails(error) },
              }).pipe(Effect.as(undefined))
              : Effect.fail(error)),
          );
        }
        /** Hand this loop to another run without restarting the process: reopen
         * its session, adopt its workflow and workspace, and hand the TUI the
         * conversation to replay. Nothing else changes — the next prompt goes
         * through the same `runPrompt`, which now sees the resumed run. */
        const resume = (runId: string) => Effect.gen(function* () {
          const context = yield* readResumeContext(runsRoot, runId, {
            wantOps: options.langfuse === true,
          });
          // `piano resume <run-id>` already opened the session on this run. Opening
          // a second one would leave two writers appending to the same log and
          // trace files.
          const next = runId === active.session.id
            ? active.session
            : yield* createSession({ cwd: session.cwd, runsRoot, id: runId });
          // Fold the end record a crash skipped, so the reopened run reads
          // `paused` instead of `running`.
          if (yield* reconcileCrashedRun(next.runDir)) {
            yield* TUI_LOG.warn("run.crash-reconciled", { data: { runId } });
          }
          // A run records the workflow it executed. Reload it so the resumed
          // prompt runs the same stages. A run that records a workflow which no
          // longer loads must fail the resume: silently keeping the current
          // workflow would run a different stage graph inside the old run dir.
          let definition: WorkflowGraphDefinition | undefined;
          let workflowNote: string | undefined;
          if (context.workflowPath === undefined) {
            workflowNote = "this run recorded no workflow; keeping the current one";
          } else {
            const reloaded = yield* loadWorkflow(context.workflowPath, session.root).pipe(
              Effect.flatMap((loaded) => graphOf(loaded).pipe(Effect.map((graph) => ({ loaded, graph })))),
              Effect.either,
            );
            if (reloaded._tag === "Right") {
              loadedWorkflow = reloaded.right.loaded;
              definition = reloaded.right.graph;
              // Guard the script-based dsh resume before the user invests a
              // turn in it: dsh gains resume through Piano's overlaid runner,
              // which needs a plugin API older dsh builds lack. Without this
              // check the gap only surfaces as a failed turn deep inside the
              // first resumed stage.
              if (reloaded.right.loaded.document.workflow.nodes.some((node) => "stage" in node && node.stage.harness === "dsh")) {
                // The probe is best effort: an unverifiable capability must
                // not block the resume, so every failure (including the
                // untyped mkdtemp defect) becomes "no verdict".
                const resumeProbe = yield* probeDshResumeCapability(resolveHarnessConfig("dsh")).pipe(
                  Effect.catchAllCause(() => Effect.succeed(undefined)),
                );
                if (resumeProbe !== undefined && resumeProbe.capability !== "supported") {
                  const note = resumeProbe.capability === "unsupported"
                    ? "the installed dsh cannot resume sessions; the next turn on this run will fail — upgrade dsh or switch the workflow to another harness"
                    : `dsh resume capability could not be verified (${resumeProbe.reason ?? "unknown error"})`;
                  workflowNote = workflowNote === undefined ? note : `${workflowNote}; ${note}`;
                  yield* TUI_LOG.warn("tui.resume_dsh_capability", {
                    data: { runId, capability: resumeProbe.capability, ...(resumeProbe.reason === undefined ? {} : { reason: resumeProbe.reason }) },
                  });
                }
              }
            } else {
              // The takeover can still open the run for inspection, but a
              // prompt must not silently execute the currently loaded workflow
              // against the old run's directory. Drop it and carry the load
              // error until an explicit workflow selection replaces it.
              loadedWorkflow = undefined;
              initialWorkflowFailure = reloaded.left;
              yield* TUI_LOG.warn("tui.resume_workflow_unavailable", {
                data: { runId, workflowPath: context.workflowPath, error: failureDetails(reloaded.left) },
              });
            }
          }
          active = { session: next, logging: loggingService(next.log, next.trace) };
          activeCwd = context.workspaceCwd ?? next.cwd;
          // A side agent belongs to the run it lives in: after a takeover its
          // next turn starts a fresh conversation under the new run's
          // directory, instead of resuming a transcript filed under the run
          // the TUI just left.
          sideContinuation = undefined;
          yield* TUI_LOG.info("tui.resumed", {
            data: { runId, turns: context.turns.length, ...(workflowNote === undefined ? {} : { note: workflowNote }) },
          });
          return {
            runId,
            turns: context.turns.map((turn) => ({
              prompt: turn.prompt,
              events: turn.events,
              status: turn.status,
              ...(turn.ops === undefined ? {} : { ops: turn.ops }),
              ...(turn.error === undefined ? {} : { error: turn.error }),
            })),
            ...(context.workspaceCwd === undefined ? {} : { workspaceCwd: context.workspaceCwd }),
            ...(definition === undefined ? {} : { workflowGraph: definition }),
            statusPath: runStatusPath(next.runDir),
          } satisfies TuiResumeResult;
        }).pipe(
          Effect.provide(NodeFileSystem.layer),
          Effect.provideService(Logging, logging),
        );
        const tuiResult = yield* TRACE(TUI_SOURCE, runTui({
          runPrompt,
          runSideAgent,
          attachObservationSink: options.langfuse === true
            ? (sink, target) => { panelSinks[target] = sink; }
            : undefined,
          // The job-level commands are the same prompt path with a different
          // instruction to the engine: resolve the job, then run it. The
          // command text is only the transcript's echo; the input actually run
          // comes from the job's recorded turn.
          runJobCommand: (action, onEvent, signoff, discuss) =>
            runPrompt(action === "continue" ? "/continue" : "/restart", onEvent, signoff, discuss, action),
          historyRoot: session.root,
          workspaceCwd: activeCwd,
          onWorkspaceChange: (cwd) => Effect.sync(() => { activeCwd = cwd; }),
          onWorkflowChange: (workflowPath, builtinName) => loadWorkflow(workflowPath, session.root).pipe(
            Effect.flatMap((nextWorkflow) => graphOf(nextWorkflow).pipe(
              Effect.map((definition) => ({ loaded: nextWorkflow, definition })),
            )),
            Effect.tap(({ loaded }) => Effect.sync(() => {
              loadedWorkflow = loaded;
              initialWorkflowFailure = undefined;
            })),
            // The picker selection is the user's default choice: record it in
            // ~/.piano/config.json so the next default run starts with it.
            // Builtins are recorded by exact template name, not package path.
            Effect.tap(() => setWorkflowSelection(
              session.root,
              builtinName === undefined ? workflowPath : builtinWorkflowSelection(builtinName),
            )),
            Effect.map(({ definition }) => definition),
            Effect.provide(NodeFileSystem.layer),
            Effect.provideService(Logging, logging),
          ),
          ...(workflowGraph === undefined ? {} : { workflowGraph }),
          statusPath: runStatusPath(session.runDir),
          ...(options.terminal === undefined ? {} : { terminal: options.terminal }),
          runsRoot,
          currentRunId: session.id,
          onResume: resume,
          ...(options.resumeRunId === undefined ? {} : { resumeRunId: options.resumeRunId }),
          ...(options.resumePicker === true ? { resumePicker: true } : {}),
          onInterrupt: (target) => Effect.sync(() => controllers[target]?.abort()),
          // Mid-turn steering: pushes the text into the target screen's live
          // prompt. "no-active-turn" (no prompt running there, or its backend
          // never bound) tells the TUI to keep queue semantics — the caller
          // never asks which harness is running.
          steerActive: (text, target) => steerings[target]?.steer(text)
            ?? Effect.succeed("no-active-turn" as const),
          // Renaming targets whichever run the TUI is showing, so it follows a
          // takeover.
          onRename: (name) => active.session.trajectory.rename(name).pipe(
            Effect.zipRight(refreshRunStatus(active.session.runDir)),
            Effect.provide(NodeFileSystem.layer),
          ),
        }));
        yield* TUI_LOG.info("tui.closed", {
          data: { stalled: tuiResult.stalled === true },
        });
        if (tuiResult.stalled === true) {
          // The TUI handed the terminal back while the interrupted run's
          // finalizers were still wedged — an orphaned harness child or a
          // stuck SDK cleanup can keep the process alive after the exit. The
          // guard guarantees `/exit` ends the process once the evidence on
          // disk has had its drain budget; the shell must never wait on it.
          yield* Effect.sync(() => { armStalledExitGuard(); });
        }
      }
    }));
  }).pipe(
    Effect.provideService(Logging, logging),
    Effect.ensuring(Effect.void),
  );
}

/** Every interactive/headless mission runs against the harness configuration
 * Piano generates from its own config. Regenerating here, once per mission,
 * is what keeps `resume` and a long-lived session from running on a stale
 * registry after the user edits `~/.piano/agent.config.json`. */
export function runSession(
  session: Session | StagingSession,
  options: SessionRunOptions,
): Effect.Effect<void, SessionRunError, import("@effect/platform").FileSystem.FileSystem> {
  return prepareHarnessHomes().pipe(
    Effect.flatMap((homes) => runSessionBody(session, {
      ...options,
      agentOptions: {
        ...(options.agentOptions ?? {}),
        ...homes.agentOptions,
        env: {
          ...(options.agentOptions?.env ?? {}),
          ...homes.env,
        },
      },
    })),
  );
}
