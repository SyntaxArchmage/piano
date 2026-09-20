# Piano TUI Testing Strategy

## Decision

Use four test layers, from smallest and fastest to closest to a user:

1. Pure logic tests for formatting, parsing, state transitions, and error mapping.
2. TUI component tests with an injected fake `Terminal`, asserting rendered rows and input handling.
3. Real pseudo-terminal integration tests using `node-pty`, asserting keyboard input, ANSI output, resize, and process cleanup.
4. A small public CLI smoke test through the user-facing `piano` entrypoint.

## Guidance

Keep the injected fake `Terminal` tests for fast component and Effect-boundary coverage. Use the PTY layer only for the small set of user-facing behaviors that depend on raw mode, ANSI rendering, process cleanup, or terminal resize.

Use `@xterm/headless` where ANSI screen interpretation is needed: it validates the virtual screen, cursor, clearing, and resize behavior more precisely than substring matching against raw terminal output.

Do not use `ink-testing-library`: it is designed for React/Ink applications, while Piano uses pi-tui.

## References

- Node.js TTY: https://nodejs.org/api/tty.html
- node-pty: https://github.com/microsoft/node-pty
- pi-tui Terminal and TUI interfaces: https://github.com/earendil-works/pi-mono/tree/main/packages/tui
- xterm headless: https://xtermjs.org/docs/api/terminal/classes/headlessterminal/
- Ink testing library (not applicable to pi-tui): https://github.com/vadimdemedes/ink-testing-library
