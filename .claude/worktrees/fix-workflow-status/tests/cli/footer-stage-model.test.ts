// The footer's WORKFLOW column can only draw a stage's model if the compiled
// workflow carries it, so this pins the wiring the renderer tests cannot see:
// the DSL's `model:` → compileWorkflow → graphOf → the status footer. Real
// runSession + real runTui + real engine on a scripted terminal; nothing is
// mocked but the harness home preparation, and no prompt is ever submitted
// because the footer draws the DAG at boot.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStagingSession } from "@piano/logging";
import { runSession } from "../../packages/cli/src/session-run.js";
import { FakeTerminal, plain, waitFor } from "../common/terminal.js";
import { settledResult, type ActorSession } from "../common/fake-runner.js";

// Same stub as the arc tests: no developer harness homes are ever touched.
vi.mock("@piano/harness", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareHarnessHomes: vi.fn(() => Effect.succeed({ agentOptions: {} })),
}));

const WORKFLOW = `version: 3
workflow:
  name: footer-model
  nodes:
    - stage:
        name: implement
        worker: basic
        harness: pi
        model: qwen3.8-flash
        tools: [read, bash, edit, write]
        from: []
`;

const ACTOR: ActorSession = {
  harness: "pi",
  sessionId: "sess-footer-model",
  transcriptPath: "/runs/footer-model/actors/pi/implement/session/sess-footer-model.jsonl",
};

afterEach(() => {
  resetCapabilitiesCache();
});

describe("the footer's WORKFLOW column", () => {
  it("draws the compiled stage model under the stage name", async () => {
    // Pin the text renderer: on an image-capable terminal the DAG is sent as a
    // picture and no stage text reaches the output at all.
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const root = await mkdtemp(join(tmpdir(), "piano-footer-model-"));
    try {
      const workflowPath = join(root, "workflow.yml");
      await writeFile(workflowPath, WORKFLOW);
      const staging = createStagingSession({ root, cwd: root, runsRoot: join(root, "runs") });
      const terminal = new FakeTerminal();
      // The WORKFLOW column is ~48% of the terminal; at the default 100 columns
      // it clips the DAG away entirely, so give the footer room to draw it.
      terminal.columns = 160;
      const done = Effect.runPromise(runSession(staging, {
        workflowPath,
        terminal,
        agentRunner: (request) => settledResult(request, "unused", ACTOR),
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      await waitFor("terminal bound", () => terminal.onInput !== undefined);
      await waitFor("footer drew the stage", () => plain(terminal).includes("implement"));

      const rows = plain(terminal).split(/\r?\n/);
      const nameRow = rows.findIndex((row) => row.includes("implement"));
      // Directly under the stage name — the row order the renderer tiers pin.
      expect(rows[nameRow + 1]).toContain("qwen3.8-flash");

      terminal.onInput?.("/exit");
      terminal.onInput?.("\r");
      await done;
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }, 30_000);
});
