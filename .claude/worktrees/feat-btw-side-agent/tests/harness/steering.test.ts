// Tier: func. The generic steering channel — capability state, not
// harness identity. Every backend's dedicated implementation (pi's SDK bind
// in pi.test.ts; subprocess backends intentionally never bind) is judged
// against this one contract: bind ⇢ "delivered", unbound ⇢ "no-active-turn".
import { describe, expect, it } from "vitest";
import { createSteeringChannel, type SteeringTarget } from "../../packages/harness/src/steering.js";

describe("steering channel", () => {
  it("answers no-active-turn before anything binds", async () => {
    const channel = createSteeringChannel();
    expect(await channel.steer("go left")).toBe("no-active-turn");
  });

  it("forwards text to the bound target and reports delivered", async () => {
    const channel = createSteeringChannel();
    const received: string[] = [];
    const target: SteeringTarget = { steer: async (text) => { received.push(text); } };
    channel.bind(target);
    expect(await channel.steer("use the second file")).toBe("delivered");
    expect(received).toEqual(["use the second file"]);
  });

  it("returns to no-active-turn once the session unbinds", async () => {
    const channel = createSteeringChannel();
    const unbind = channel.bind({ steer: async () => undefined });
    expect(await channel.steer("mid-turn")).toBe("delivered");
    unbind();
    expect(await channel.steer("too late")).toBe("no-active-turn");
  });

  it("treats a backend that binds nothing as unbound (capability probe)", async () => {
    // A session without a native steer primitive binds `undefined` — the
    // channel must behave exactly as if no turn were running.
    const channel = createSteeringChannel();
    channel.bind(undefined);
    expect(await channel.steer("anything")).toBe("no-active-turn");
  });

  it("never lets a stale unbind steal a newer session's binding", async () => {
    const channel = createSteeringChannel();
    const first: SteeringTarget = { steer: async () => undefined };
    const second: SteeringTarget = { steer: async () => undefined };
    const unbindFirst = channel.bind(first);
    const unbindSecond = channel.bind(second);
    unbindFirst(); // older session's cleanup runs after the newer bind
    expect(await channel.steer("still live")).toBe("delivered");
    unbindSecond();
    expect(await channel.steer("ended")).toBe("no-active-turn");
  });

  it("ignores blank text without touching the target", async () => {
    const channel = createSteeringChannel();
    let called = 0;
    channel.bind({ steer: async () => { called += 1; } });
    expect(await channel.steer("   ")).toBe("no-active-turn");
    expect(called).toBe(0);
  });

  it("surfaces a refusal from the live session as a rejection", async () => {
    // A bound session that rejects is a third answer distinct from
    // "no-active-turn": the caller must see the failure, not a silent queue.
    const channel = createSteeringChannel();
    channel.bind({ steer: async () => { throw new Error("session closed"); } });
    await expect(channel.steer("redirect")).rejects.toThrow("session closed");
  });
});
