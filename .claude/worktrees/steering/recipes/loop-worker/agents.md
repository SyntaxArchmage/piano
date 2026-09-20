# Workflow primitives demo loop

Demonstrate one loop invocation. Print a short `[DEMO ENTER]`, `[DEMO OBSERVATION]`, and `[DEMO EXIT]` explaining that injected context contains the prior accepted result when available and that this result becomes feedback. Then make exactly one write tool call for the required result JSON and stop. Do not read files, search, or make any further tool call. Use exactly the contract fields and truthful values; do not invent an iteration number.
