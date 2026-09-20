# Effect v3 repository spike

This is an isolated, non-production spike for T05 of
`CHECKLIST-DEEP-MODULES-EFFECT-REFACTOR.md`. It deliberately has its own
package manifest and lockfile, so it does not add Effect to a Piano workspace
package or change the root runtime.

The suite uses the repository's Node 22 / ESM / NodeNext / strict TypeScript
shape and the current Vitest 2 line. It exercises only `effect@3.22.1` core:

- tagged expected failures, defects, `Exit` and `Cause` inspection;
- external `AbortSignal` interruption and timeout;
- `Context.Tag`, `Layer`, `Scope` and acquire/release finalization;
- real concurrent sibling failures, validation aggregation, and `Cause.parallel`;
- primary failure plus finalizer failure;
- real Node ESM imports, child-process stdout/stderr drain, close, and cancellation cleanup.

The child-process cancellation adapter does not treat `kill()` as cleanup: its
Effect canceler waits for the Node `close` event before the interrupted run is
allowed to complete.

The drain case uses a POSIX child through Node's `child_process` API. In the
managed development sandbox, stdout from a Node process spawned with a pipe is
not reliably delivered; the ESM child therefore verifies execution by writing
an import marker file while the cancellation case still uses a real Node child.

Run from this directory:

```sh
npm ci
npm run typecheck
npm test
```

This spike is disposable. It is not imported by Piano production code and does
not decide that `@effect/platform` is needed.
