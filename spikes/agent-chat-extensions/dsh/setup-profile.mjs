// Prepare an isolated dsh profile for the piano-spike experiment.
//
//   node setup-profile.mjs /tmp/dsh-piano-spike
//
// Creates <root>/{home,workspace}, initializes the temporary DSH_HOME's
// `dsh-spike` profile from the shipped `web` template, and writes the profile
// patch that inserts this spike's dual-face plugin and points the DeepSeek
// adapter at the local fake provider. It never reads or writes ~/.dsh.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? "");
if (process.argv[2] === undefined) {
  console.error("usage: node setup-profile.mjs <work-root>");
  process.exit(2);
}
const home = join(root, "home");
const workspace = join(root, "workspace");
const profileDir = join(home, "profiles", "dsh-spike");
const pluginPath = fileURLToPath(new URL("./plugin/lib/index.js", import.meta.url));
const llmBaseUrl = process.env.SPIKE_LLM_BASE_URL ?? "http://127.0.0.1:39871";

mkdirSync(workspace, { recursive: true });
mkdirSync(home, { recursive: true });

if (!existsSync(join(profileDir, "package.json"))) {
  execFileSync(
    "dsh",
    ["--profile", "dsh-spike", "--from-default-profile", "web", "--dump-default-config"],
    { env: { ...process.env, DSH_HOME: home }, stdio: "ignore" },
  );
}

const patch = `# Spike-only user layer for the temporary dsh profile.
# It points the DeepSeek adapter at the local deterministic stand-in and
# inserts the local dual-face piano-spike plugin (host tool + browser Chat node).
- id: llm-deepseek
  config:
    apiKeyEnv: DSH_SPIKE_API_KEY
    baseURL: ${llmBaseUrl}

- insert:
    - id: piano-spike
      name: ${pluginPath}
`;
writeFileSync(join(profileDir, "cordis.patch.yml"), patch);

console.log(
  JSON.stringify(
    {
      home,
      workspace,
      profileDir,
      pluginPath,
      llmBaseUrl,
      boot: `DSH_HOME=${home} DSH_SPIKE_API_KEY=spike dsh --profile dsh-spike --port 3099 --no-open`,
    },
    null,
    2,
  ),
);
