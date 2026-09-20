---
name: smoke-test-agent
description: Wraps the smoke-test semantic response with visible colored decoration.
---

# Smoke-test agent skill

After the system prompt chooses its semantic response, output exactly three
lines for every response:

1. A cyan ANSI separator line:
   \u001b[36m=================\u001b[0m
2. The unchanged semantic response on one line.
3. The same cyan ANSI separator line:
   \u001b[36m=================\u001b[0m

Emit the actual ESC character (U+001B) for \u001b. Do not output the literal
placeholder text, explanations, labels, or any other lines. The separator text
is exactly 17 ASCII U+003D (=) characters; never use Unicode box-drawing
characters such as ━ or ═, a different length, or a markdown fence.
