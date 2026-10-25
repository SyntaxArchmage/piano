// Tier: func. The generic steering channel — capability state, not
// harness identity. Every backend's dedicated implementation (pi's SDK bind
// in pi.test.ts; claude's and dsh's stdin bridges in subprocess.test.ts) is
// judged against this one contract: bind ⇢ "delivered", unbound ⇢
// "no-active-turn".
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AgentError } from "../../packages/harness/src/errors.js";
import { createSteeringChannel, type SteeringTarget } from "../../packages/harness/src/steering.js";

const steer = (channel: ReturnType<typeof createSteeringChannel>, text: string) =>
  Effect.runPromise(channel.steer(text));

describe("steering channel", () => {
  it("answers no-active-turn before anything binds", async () => {
    const channel = createSteeringChannel();
    expect(await steer(channel, "go left")).toBe("no-active-turn");
  });

  it("forwards text to the bound target and reports delivered", async () => {
    const channel = createSteeringChannel();
    const received: string[] = [];
    const target: SteeringTarget = {
      steer: (text) => Effect.sync(() => { received.push(text); }),
    };
    channel.bind(target);
    expect(await steer(channel, "use the second file")).toBe("delivered");
    expect(received).toEqual(["use the second file"]);
  });

  it("returns to no-active-turn once the session unbinds", async () => {
    const channel = createSteeringChannel();
    const unbind = channel.bind({ steer: () => Effect.void });
    expect(await steer(channel, "mid-turn")).toBe("delivered");
    unbind();
    expect(await steer(channel, "too late")).toBe("no-active-turn");
  });

  it("treats a backend that binds nothing as unbound (capability probe)", async () => {
    // A session without a native steer primitive binds `undefined` — the
    // channel must behave exactly as if no turn were running.
    const channel = createSteeringChannel();
    channel.bind(undefined);
    expect(await steer(channel, "anything")).toBe("no-active-turn");
  });

  it("never lets a stale unbind steal a newer session's binding", async () => {
    const channel = createSteeringChannel();
    const first: SteeringTarget = { steer: () => Effect.void };
    const second: SteeringTarget = { steer: () => Effect.void };
    const unbindFirst = channel.bind(first);
    const unbindSecond = channel.bind(second);
    unbindFirst(); // older session's cleanup runs after the newer bind
    expect(await steer(channel, "still live")).toBe("delivered");
    unbindSecond();
    expect(await steer(channel, "ended")).toBe("no-active-turn");
  });

  it("ignores blank text without touching the target", async () => {
    const channel = createSteeringChannel();
    let called = 0;
    channel.bind({ steer: () => Effect.sync(() => { called += 1; }) });
    expect(await steer(channel, "   ")).toBe("no-active-turn");
    expect(called).toBe(0);
  });

  it("surfaces a refusal from the live session instead of reporting delivery", async () => {
    // A bound session that fails is a third answer distinct from
    // "no-active-turn": the caller must see the failure, not a silent queue.
    const channel = createSteeringChannel();
    channel.bind({
      steer: () => Effect.fail(new AgentError({ kind: "request-rejected", message: "session closed" })),
    });
    await expect(steer(channel, "redirect")).rejects.toThrow("session closed");
  });
});
