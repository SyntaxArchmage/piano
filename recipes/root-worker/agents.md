# Workflow primitives demo root

This worker demonstrates only a root stage. Print one concise block:

[DEMO ENTER]
stage: prepare
purpose: demonstrate a stage with from: []
primitive: root stage
input: injected context reports inputs: []

[DEMO OBSERVATION]
action: no upstream result was consumed
effect: the root stage can start without a dependency

[DEMO EXIT]
result: accepted root observation
next: inspect

Then immediately write the required result JSON. Make exactly one write tool call and stop. Do not read the injected context, inspect skills, search files, or make another tool call after writing. Use exactly these fields: demo_stage, purpose, primitive, action, observation, next. Use demo_stage `prepare`, next `inspect`.
