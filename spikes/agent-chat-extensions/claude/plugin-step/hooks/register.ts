// Spike mod: prove whether a turn.step hook can yield assistant-role text
// chunks sourced from a child process.
//
// Two modes, chosen with PIANO_SPIKE_STEP_MODE:
//   prepend (default) -> read the child to its end, yield its lines as text
//                        chunks of block 0, then forward the model response.
//                        This delays the request by the child's lifetime.
//   interleave        -> run the child and the model request concurrently and
//                        merge both streams in arrival order, holding the
//                        model's stop chunk until the child is done.
import type { EngineInterface, Register, TurnStepChunk, TurnStepTextChunk } from "claude-code";

const PREFIX = "[piano-spike-step]";
let injected = false;

/** Split streamed text into lines; a piece may hold several or half a line. */
function makeLineSplitter(emit: (line: string) => void): {
  push: (text: string) => void;
  flush: () => void;
} {
  let pending = "";
  return {
    push(text: string): void {
      pending += text;
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (line.trim() !== "") emit(line);
        newline = pending.indexOf("\n");
      }
    },
    flush(): void {
      const line = pending.replace(/\r$/, "");
      pending = "";
      if (line.trim() !== "") emit(line);
    },
  };
}

/** The child whose output becomes assistant text. 3 lines over ~0.8s. */
function spawnChild($: EngineInterface) {
  return $.process.spawn({
    argv: [
      "bash",
      "-c",
      `for i in 1 2 3; do echo "${PREFIX} injected assistant line $i/3"; sleep 0.4; done`,
    ],
  });
}

function textChunk(text: string, index: number): TurnStepTextChunk {
  return { kind: "text", index, text };
}

/** Read the child to its end and return its stdout lines. */
async function collectChildLines($: EngineInterface): Promise<string[]> {
  const lines: string[] = [];
  const child = spawnChild($);
  const splitter = makeLineSplitter((line) => lines.push(line));
  for await (const piece of child) {
    if (piece.stream === "stdout") splitter.push(piece.text);
  }
  splitter.flush();
  await child.result;
  return lines;
}

export const register: Register = (on) => {
  on("turn.step", async function* ($, e, next) {
    const mode = (await $.env.get("PIANO_SPIKE_STEP_MODE")) ?? "prepend";

    if (mode !== "interleave") {
      if (!injected) {
        injected = true;
        const lines = await collectChildLines($);
        for (const line of lines) yield textChunk(`${line}\n`, 0);
      }
      return yield* next(e);
    }

    // Interleave: both streams feed one queue in arrival order. The model's
    // stop chunk waits until the child has ended, so no text follows it.
    const model = next(e);
    const queue: TurnStepChunk[] = [];
    let wake: (() => void) | undefined;
    let heldStop: TurnStepChunk | undefined;
    let childDone = false;
    let modelDone = false;
    const signal = (): void => {
      if (wake !== undefined) {
        const resume = wake;
        wake = undefined;
        resume();
      }
    };
    const push = (chunk: TurnStepChunk): void => {
      queue.push(chunk);
      signal();
    };

    const childWork = (async () => {
      if (!injected) {
        injected = true;
        const splitter = makeLineSplitter((line) => push(textChunk(`${line}\n`, 0)));
        try {
          for await (const piece of spawnChild($)) {
            if (piece.stream === "stdout") splitter.push(piece.text);
          }
          splitter.flush();
        } catch {
          // The model finishing first ends the turn; the child is left behind.
        }
      }
      childDone = true;
      signal();
    })();

    const modelWork = (async () => {
      for await (const chunk of model) {
        if (chunk.kind === "stop") heldStop = chunk;
        else push(chunk);
      }
      modelDone = true;
      signal();
    })();

    while (true) {
      const chunk = queue.shift();
      if (chunk !== undefined) {
        yield chunk;
        continue;
      }
      if (modelDone && childDone) {
        if (heldStop !== undefined) {
          yield heldStop;
          heldStop = undefined;
        }
        break;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    void childWork;
    await modelWork;
    return await model.result;
  });
};
