import { spawnSync } from "node:child_process";
import { Effect } from "effect";
import { io } from "@piano/base";

/** Well-known system CA bundle locations, in the order distributions ship
 * them: Debian/Ubuntu, RHEL/CentOS/Fedora (and its p11-kit extract), openSUSE,
 * Alpine. */
const SYSTEM_CA_BUNDLES = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
  "/etc/ssl/ca-bundle.pem",
  "/etc/ssl/cert.pem",
] as const;

/** `--use-system-ca` was added in Node 22.15 / 23.x and covers platforms
 * whose trust store is not a PEM file on disk (macOS Keychain, Windows). */
function supportsUseSystemCa(): boolean {
  const match = /^v?(\d+)\.(\d+)/.exec(process.version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major >= 23 || (major === 22 && minor >= 15);
}

/** Re-exec the CLI once with the OS trust store wired into Node, when Node
 * would otherwise trust only its bundled Mozilla roots.
 *
 * Node reads `NODE_EXTRA_CA_CERTS` at process start, so setting it from inside
 * the process is too late — hosts behind a local or corporate CA (an internal
 * gateway, a Caddy-issued development certificate) fail every fetch with
 * "unable to get local issuer certificate" while `curl`, which reads the
 * system store, works. The user can always win by setting the variable
 * themselves; this only fills the gap when they did not, and the
 * `PIANO_CA_BOOTSTRAPPED` sentinel guarantees at most one re-exec. */
export function ensureSystemCaTrust(): void {
  if (process.env.PIANO_CA_BOOTSTRAPPED === "1") return;
  if (process.env.NODE_EXTRA_CA_CERTS !== undefined && process.env.NODE_EXTRA_CA_CERTS !== "") return;
  const entry = process.argv[1];
  if (entry === undefined) return;

  // The bundle check runs before the Effect runtime exists (this function is
  // called before `runCli` builds its runtime), so the io Effect is driven with
  // Effect.runSync at that synchronous bootstrap edge.
  const bundle = SYSTEM_CA_BUNDLES.find((candidate) => Effect.runSync(io.existsSync(candidate)));
  const env: NodeJS.ProcessEnv = { ...process.env, PIANO_CA_BOOTSTRAPPED: "1" };
  const execArgv = [...process.execArgv];
  if (bundle !== undefined) {
    env.NODE_EXTRA_CA_CERTS = bundle;
  } else if (supportsUseSystemCa() && !execArgv.includes("--use-system-ca")) {
    execArgv.push("--use-system-ca");
  } else {
    return;
  }

  // The one deliberate spawnSync: Node reads NODE_EXTRA_CA_CERTS at process
  // start, so the only fix is to re-exec — and that must happen synchronously,
  // before any Effect runtime exists. This call replaces the process rather
  // than composing with it, so it cannot be an io.execFile Effect.
  const result = spawnSync(process.execPath, [...execArgv, entry, ...process.argv.slice(2)], {
    stdio: "inherit",
    env,
  });
  if (result.error !== undefined) return;
  if (result.signal !== null) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(result.status ?? 1);
}
