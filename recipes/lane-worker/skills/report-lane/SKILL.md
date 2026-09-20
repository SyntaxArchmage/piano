---
name: report-lane
description: Explain one isolated tournament lane without guessing sibling behavior.
---

Print `[DEMO LANE]` with the received item, lane-local action, and result. State that this lane demonstrates isolated fan-out. Do not claim sibling concurrency or a winner unless that fact is explicitly present in the runtime context. Return the item as an object under `item`.
