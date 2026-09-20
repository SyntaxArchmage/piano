# basic worker

The `basic` worker plugin deliberately provides no system prompt, context file,
or skills. Absent overrides mean the stage's harness keeps its built-in system
prompt (or, for the `dsh` adapter, the preset's own defaults). The shipped
`workflows/coding-<harness>.yml` templates run the stage on their named adapter
and declare that harness's standard coding tools.

The directory is intentionally present: every workflow `worker` must resolve
to a real plugin under `recipes/`.
