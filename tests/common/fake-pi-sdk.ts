// Fake Pi SDK whose "model memory" lives only on the session opened from the
// previous turn's transcript: a new create starts with empty history, an open
// continues it. Records create/open counts and every prompt text. Extracted
// from tests/tui/basic-workflow-coding.test.ts so the session-arc tests can
// reuse it; it stands in for "sending the prompt" while the real harness
// session bookkeeping (SessionManager.create/open) runs.

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { PiModule } from "@piano/harness";

export interface FakeSdkState {
  createCalls: number;
  openCalls: number;
  promptTexts: string[];
  history: string[];
  transcriptPath: string;
  /** Gates awaited inside session.prompt, one per attempt index (1-based). */
  gates: Array<() => void>;
}

/** Build a fake pi module + the state its prompts share. */
export function makeFakeSdk(): { state: FakeSdkState; sdk: PiModule } {
  const state: FakeSdkState = {
    createCalls: 0,
    openCalls: 0,
    promptTexts: [],
    history: [],
    transcriptPath: "",
    gates: [],
  };
  const makeSession = (manager: { reopened: boolean; transcriptPath?: string; sessionDir?: string }) => {
    const sessionFile = manager.reopened
      ? manager.transcriptPath!
      : join(manager.sessionDir!, "pi-session.jsonl");
    let listener: ((event: unknown) => void) | undefined;
    return {
      sessionId: "pi-session-1",
      sessionFile,
      subscribe(cb: (event: unknown) => void): () => void {
        listener = cb;
        return () => { listener = undefined; };
      },
      async prompt(text: string): Promise<void> {
        state.promptTexts.push(text);
        const gate = new Promise<void>((resolve) => state.gates.push(resolve));
        await gate; // hold the turn until the test releases it
        const remembered = manager.reopened ? state.history.join(" | ") : "empty";
        const reply = `answer to "${text}"; history: ${remembered}`;
        if (!manager.reopened) state.transcriptPath = sessionFile;
        appendFileSync(sessionFile, `${JSON.stringify({ user: text, reply })}\n`);
        state.history.push(text, reply);
        listener?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: reply } });
        listener?.({ type: "message_end", message: { content: reply } });
      },
      abort: async () => undefined,
      dispose: () => undefined,
    };
  };
  const sdk = {
    ModelRuntime: { create: async () => ({ getModel: () => ({ id: "model" }), setRuntimeApiKey: async () => undefined }) },
    SessionManager: {
      create: (cwd: string, sessionDir: string) => {
        state.createCalls += 1;
        return { reopened: false, sessionDir };
      },
      open: (transcriptPath: string, _sessionDir: string, _cwd: string) => {
        state.openCalls += 1;
        return { reopened: true, transcriptPath };
      },
    },
    SettingsManager: { inMemory: () => ({}) },
    DefaultResourceLoader: class {
      constructor(options: Record<string, unknown>) { void options; }
      reload = async () => undefined;
    },
    createAgentSession: async (options: { sessionManager: { reopened: boolean; transcriptPath?: string; sessionDir?: string } }) => ({
      session: makeSession(options.sessionManager),
    }),
  };
  return { state, sdk: sdk as unknown as PiModule };
}
