---
name: inspect-handoff
description: Explain how an upstream handoff reaches the current demonstration stage.
---

Use the injected handoff context supplied to this stage; do not search the workspace. Name the input and one concrete field observed, then continue immediately to the required result write. For a root stage, report `inputs: []` and do not perform another read. If an input is absent, say so; never replace it with an invented value.
