import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit } from "effect";
import {
  createSession,
  Logging,
  loggingService,
} from "./packages/logging/src/index.js";
import { loadAndExecuteWorkflow } from "./packages/orchestrator/src/index.js";

const root = process.cwd();
const cwd = root;
const DECORATION = "=================";

function protocolLines(text: string): string[] {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function matchesProtocol(text: string, semantic: string): boolean {
  return protocolLines(text).join("\n") === `${DECORATION}\n${semantic}\n${DECORATION}`;
}

const session = await Effect.runPromise(
  createSession({ root, cwd }).pipe(Effect.provide(NodeFileSystem.layer)),
);

const cases = [
  { prompt: "What is 2 + 2?", semantic: "ans = 4" },
  { prompt: "What is your name?", semantic: "please ask math calculation only" },
] as const;

for (const testCase of cases) {
  const result = await Effect.runPromiseExit(
    loadAndExecuteWorkflow({
      root,
      workflowPath: join(root, "scripts/smoke-workflow.yml"),
      runDir: session.runDir,
      cwd,
      prompt: testCase.prompt,
    }).pipe(
      Effect.provideService(Logging, loggingService(session.log, session.trace)),
      Effect.provide(NodeFileSystem.layer),
    ),
  );

  if (Exit.isFailure(result)) {
    console.error("SMOKE TEST FAILED:");
    console.error(result.cause);
    await Effect.runPromise(session.log.flush().pipe(Effect.ignore));
    process.exit(1);
  }

  console.log("PROMPT:    ", testCase.prompt);
  console.log("WORKFLOW:  ", result.value.workflow);
  console.log("STAGE:     ", result.value.stage);
  console.log("WORKER:    ", result.value.worker);
  console.log("SESSION:   ", result.value.sessionId);
  console.log("TRANSCRIPT:", result.value.transcriptPath);
  console.log("RESPONSE:  ", JSON.stringify(result.value.text));

  if (!matchesProtocol(result.value.text, testCase.semantic)) {
    console.log("\nSMOKE TEST FAILED: unexpected protocol response");
    process.exit(1);
  }
}

await Effect.runPromise(Effect.all([session.log.flush(), session.trace.flush()]).pipe(Effect.ignore));
console.log("\nSMOKE TEST PASSED");
