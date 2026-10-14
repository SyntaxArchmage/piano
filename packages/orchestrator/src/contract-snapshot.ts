import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import type { CompiledWorkerContract } from "@piano/contract";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";

export interface WorkerContractReference {
  readonly id: string;
  readonly version: 1;
  readonly digest: string;
  readonly snapshotPath: string;
}

function snapshotError(path: string, operation: string, cause: unknown): WorkflowError {
  return workflowError("schedule", path, `${operation}: ${errorMessage(cause)}`);
}

const snapshotSemaphore = Effect.unsafeMakeSemaphore(1);

/** Persist the exact declarative contract before a validating worker starts. */
export function snapshotWorkerContract(
  runDir: string,
  contract: CompiledWorkerContract,
): Effect.Effect<WorkerContractReference, WorkflowError, FileSystem.FileSystem> {
  const snapshotPath = join(runDir, "contracts", `${contract.digest}.json`);
  return snapshotSemaphore.withPermits(1)(Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const exists = yield* fileSystem.exists(snapshotPath).pipe(
      Effect.mapError((cause) => snapshotError(snapshotPath, "contract snapshot exists", cause)),
    );
    if (exists) {
      const persisted = yield* fileSystem.readFileString(snapshotPath).pipe(
        Effect.mapError((cause) => snapshotError(snapshotPath, "contract snapshot read", cause)),
      );
      if (persisted !== contract.source) {
        return yield* Effect.fail(snapshotError(
          snapshotPath,
          "contract snapshot verify",
          "existing digest-addressed snapshot does not match the loaded contract",
        ));
      }
    } else {
      yield* writeFileAtomic(snapshotPath, contract.source, {
        temporaryPath: `${snapshotPath}.tmp-${process.pid}-${randomUUID()}`,
        mapError: (cause, step) => snapshotError(snapshotPath, `contract snapshot ${step}`, cause),
      });
    }
    return {
      id: contract.manifest.id,
      version: contract.manifest.version,
      digest: contract.digest,
      snapshotPath,
    };
  }));
}
