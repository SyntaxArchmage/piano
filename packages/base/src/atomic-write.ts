// The one way a file is replaced whole.
//
// A reader must see either the previous bytes or the next ones, never a half
// written file: the contents land in a staging sibling and are renamed over the
// target. Every package that rewrites a document goes through this, so the
// rename fallback for filesystems that refuse to replace in place exists once.

import { FileSystem } from "@effect/platform";
import { Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { errorMessage } from "./errors.js";

/** One step of an atomic write, named so a caller can keep its own error
 * wording per step rather than settling for one message for all three. */
export type AtomicWriteStep = "mkdir" | "write" | "rename";

/** A caller's mapping from a filesystem cause and the step that produced it to
 * the error type its own Effect signature declares. */
export type AtomicWriteErrorMapper<E> = (cause: unknown, step: AtomicWriteStep) => E;

/** Whether a rename was refused because the destination is in the way rather
 * than because something else went wrong. */
function isReplaceConflict(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = (cause as { readonly code?: unknown }).code;
  const reason = (cause as { readonly reason?: unknown }).reason;
  return code === "EEXIST" || code === "EPERM" ||
    reason === "AlreadyExists" || reason === "PermissionDenied";
}

/** Install a prepared sibling file over `path`. Where the filesystem accepts a
 * plain rename that is the whole story; some Windows and network filesystems
 * refuse rename-over-existing, so a refused rename moves the destination to a
 * random sibling first and puts it back if the install then fails. The
 * fallback is recoverable rather than a silent delete. Exported for the callers
 * that stage, adjust and install in steps of their own. */
export function installStagingFile<E>(
  fileSystem: FileSystem.FileSystem,
  staging: string,
  path: string,
  mapError: AtomicWriteErrorMapper<E>,
): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    const direct = yield* Effect.either(fileSystem.rename(staging, path));
    if (Either.isRight(direct)) return;
    if (!isReplaceConflict(direct.left)) {
      return yield* Effect.fail(mapError(direct.left, "rename"));
    }

    const backup = join(dirname(path), `.${basename(path)}.piano-replace-${randomUUID()}.bak`);
    const preserved = yield* Effect.either(fileSystem.rename(path, backup));
    if (Either.isLeft(preserved)) {
      return yield* Effect.fail(mapError(
        new Error(`atomic replace failed: ${errorMessage(direct.left)}; destination preservation failed: ${errorMessage(preserved.left)}`),
        "rename",
      ));
    }
    const installed = yield* Effect.either(fileSystem.rename(staging, path));
    if (Either.isLeft(installed)) {
      const restored = yield* Effect.either(fileSystem.rename(backup, path));
      const restoreStatus = Either.isRight(restored)
        ? "original destination restored"
        : `original destination restore failed: ${errorMessage(restored.left)}; backup preserved at ${backup}`;
      return yield* Effect.fail(mapError(
        new Error(`atomic replace fallback failed: ${errorMessage(installed.left)}; ${restoreStatus}`),
        "rename",
      ));
    }
    yield* fileSystem.remove(backup).pipe(
      Effect.mapError((cause) => mapError(
        new Error(`atomic replace completed but backup cleanup failed at ${backup}: ${errorMessage(cause)}`),
        "rename",
      )),
    );
  });
}

/** Write `contents` to `path` so a reader sees either the previous file or the
 * new one and never a half-written document: the bytes land in a staging file
 * renamed over the target. The staging name is asked for on every run, so
 * re-running one effect value does not reuse it, and the staging file is
 * removed whichever way the write ends, so a failure leaves no residue. */
export function writeFileAtomic<E>(
  path: string,
  contents: string | Uint8Array,
  options: {
    /** A fresh staging sibling per call. Two writes to one path can be in
     * flight together, and a shared name would let one cleanup delete the
     * other's staged bytes. */
    readonly temporaryPath: () => string;
    readonly mapError: AtomicWriteErrorMapper<E>;
    /** Create the staging file exclusively, so a pre-created predictable name
     * cannot be followed through a symlink. Off by default: callers that name
     * the staging file freshly would otherwise turn a leftover from a crashed
     * run into a failure. */
    readonly exclusiveStaging?: boolean;
    /** Install through {@link installStagingFile} rather than a bare rename. */
    readonly installWithBackup?: boolean;
  },
): Effect.Effect<void, E, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const staging = options.temporaryPath();
    // A staging name equal to the target would rewrite the file and then let
    // the cleanup delete it, reporting success over lost bytes.
    if (staging === path) {
      return yield* Effect.fail(options.mapError(
        new Error("atomic write staging path must differ from its target"),
        "write",
      ));
    }
    const writeOptions = options.exclusiveStaging === true ? { flag: "wx" as const } : undefined;
    yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError((cause) => options.mapError(cause, "mkdir")),
    );
    yield* Effect.gen(function* () {
      yield* (typeof contents === "string"
        ? fileSystem.writeFileString(staging, contents, writeOptions)
        : fileSystem.writeFile(staging, contents, writeOptions)).pipe(
        Effect.mapError((cause) => options.mapError(cause, "write")),
      );
      yield* (options.installWithBackup === true
        ? installStagingFile(fileSystem, staging, path, options.mapError)
        : fileSystem.rename(staging, path).pipe(
          Effect.mapError((cause) => options.mapError(cause, "rename")),
        ));
    }).pipe(Effect.ensuring(fileSystem.remove(staging).pipe(Effect.ignore)));
  });
}