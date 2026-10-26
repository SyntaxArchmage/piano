import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { contractSnapshotPath, writeFileAtomic } from "@piano/base";
import type { CompiledWorkerContract } from "@piano/contract";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";

function snapshotError(path: string, operation: string, cause: unknown): WorkflowError {
  return workflowError("schedule", path, `${operation}: ${errorMessage(cause)}`);
}

const snapshotSemaphore = Effect.unsafeMakeSemaphore(1);

/** The run-local path a worker's contract copy lives at — the run layout's
 * rule, exposed so a rebuilt invocation can list it without rewriting it. */
export function workerContractSnapshotPath(runDir: string, worker: string): string {
  return contractSnapshotPath(runDir, worker);
}

/** Persist the exact declarative contract before a validating worker starts.
 * The run-local copy must be the contract actually in force: validation,
 * guidance and the injected snapshot are all built from one loaded contract,
 * so a copy another span wrote (a resumed run whose `recipes/contracts/
 * <worker>.json` changed) is replaced atomically when its bytes differ. An
 * equal copy is left untouched. */
export function snapshotWorkerContract(
  runDir: string,
  contract: CompiledWorkerContract,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const snapshotPath = workerContractSnapshotPath(runDir, contract.worker);
  return snapshotSemaphore.withPermits(1)(Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const exists = yield* fileSystem.exists(snapshotPath).pipe(
      Effect.mapError((cause) => snapshotError(snapshotPath, "contract snapshot exists", cause)),
    );
    const current = exists
      ? yield* fileSystem.readFileString(snapshotPath).pipe(
        Effect.mapError((cause) => snapshotError(snapshotPath, "contract snapshot read", cause)),
      )
      : undefined;
    if (current !== contract.source) {
      yield* writeFileAtomic(snapshotPath, contract.source, {
        mapError: (cause, step) => snapshotError(snapshotPath, `contract snapshot ${step}`, cause),
      });
    }
    return snapshotPath;
  }));
}
