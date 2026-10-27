#!/usr/bin/env node
/* global process, setInterval, clearInterval */
// Heartbeat/Piano NDJSON stand-in for the spike.
// Emits one NDJSON line per tick on stdout, exactly like a long-running child
// whose output a host client would consume line by line.
//
// Env: HEARTBEAT_TICKS (default 8), HEARTBEAT_INTERVAL_MS (default 500)

const ticks = Number(process.env.HEARTBEAT_TICKS || 8);
const interval = Number(process.env.HEARTBEAT_INTERVAL_MS || 500);

let tick = 0;
const timer = setInterval(() => {
  tick += 1;
  process.stdout.write(
    JSON.stringify({
      type: "heartbeat",
      tick,
      total: ticks,
      ts: new Date().toISOString(),
      text: `PIANO-HEARTBEAT ${tick}/${ticks}`,
    }) + "\n",
  );
  if (tick >= ticks) {
    clearInterval(timer);
    process.stdout.write(
      JSON.stringify({ type: "heartbeat.done", ticks, ts: new Date().toISOString() }) + "\n",
    );
  }
}, interval);
