#!/usr/bin/env node
// Generic GitHub pull-request program — the PR-side twin of the issues
// helpers. Same credential discipline: the token is read inside this process
// and sent only as the Authorization Bearer header; it is never printed,
// interpolated into output, or taken from command arguments. The repository
// derives from the origin remote (or --repo / GITHUB_REPO); the API root
// resolves in the order GITHUB_API_URL, api.github.com for a github.com
// remote, then https://HOST/api/v3 derived from the origin remote. An HTTP
// (non-TLS) API root must be configured explicitly by the user — never fall
// back to it silently.
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_ENV_FILE = join(homedir(), '.claude', '.env');

export class GitHubPrError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'GitHubPrError';
  }
}

function usage() {
  return `Usage: github-pr <command> [options]

Commands:
  list       List pull requests
  get        Get one pull request
  create     Create a pull request
  update     Update a pull request
  close      Close a pull request
  reopen     Reopen a pull request
  comment    Add a pull request comment
  merge      Merge a pull request (requires --confirm)

Common options:
  --repo <owner/name>       GitHub repository; defaults to GITHUB_REPO or origin remote
  --number <n>              Pull request number for single-PR commands
  --source-branch <name>    Head branch (create default: current git branch)
  --target-branch <name>    Base branch (create default: main)
  --title <text>            Pull request title
  --description <text>      Description markdown (sent as the PR body)
  --description-file <path> Read description markdown from a file (UTF-8)
  --body <text>             Comment body
  --body-file <path>        Read comment body from a file (UTF-8)
  --labels <a,b>            Comma-separated labels
  --assignees <u1,u2>       Comma-separated user logins
  --draft                   Open the pull request as a draft
  --state <open|closed|all> List filter
  --search <text>           List search (uses the issue search endpoint)
  --page <number>           List page (default: 1)
  --per-page <number>       List size (default: 100)
  --merge-method <merge|squash|rebase>  Merge method (default: merge)
  --remove-source-branch    Delete the head branch after merge
  --confirm                 Required for merge
  --json <object>           Additional JSON request fields

Configuration:
  GITHUB_TOKEN is read from ~/.claude/.env (or GITHUB_ENV_FILE); when the
  file carries none, the program falls back to \`gh auth token\` so the
  credential stays out of the agent's hands either way.
  GITHUB_API_URL optionally overrides the API root;
  GITHUB_REPO optionally overrides repository discovery.
`;
}

const BOOLEAN_OPTIONS = new Set(['confirm', 'draft', 'remove_source_branch']);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith('--')) throw new GitHubPrError(`unexpected argument: ${argument}`);
    const key = argument.slice(2).replaceAll('-', '_');
    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new GitHubPrError(`missing value for --${key.replaceAll('_', '-')}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function parseDotEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/u, '');
    }
    values[key] = value;
  }
  return values;
}

async function tokenFromGhCli() {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { encoding: 'utf8' });
    const token = stdout.trim();
    if (token) return token;
  } catch {
    // Fall through to the error below; gh is only one source of the token.
  }
  return undefined;
}

async function loadConfig(env) {
  const envFile = env.GITHUB_ENV_FILE || DEFAULT_ENV_FILE;
  let fileValues = {};
  try {
    fileValues = parseDotEnv(await readFile(envFile, 'utf8'));
  } catch {
    // A missing file is fine when the token comes from gh instead.
  }
  const token = fileValues.GITHUB_TOKEN ?? (await tokenFromGhCli());
  if (!token) {
    throw new GitHubPrError(
      `GITHUB_TOKEN is missing in ${envFile} and gh auth token returned nothing`,
    );
  }
  return {
    token,
    apiUrl: env.GITHUB_API_URL ?? fileValues.GITHUB_API_URL,
    repo: env.GITHUB_REPO ?? fileValues.GITHUB_REPO,
  };
}

function repoFromRemote(remote) {
  const value = remote.trim().replace(/\.git$/u, '');
  const match = value.match(/^(?:https?:\/\/[^/]+\/|ssh:\/\/git@[^/]+\/|git@[^:]+:)(.+)$/u);
  if (!match?.[1]) throw new GitHubPrError('cannot derive GitHub owner/repo from remote');
  return match[1];
}

async function resolveRepo(options, config, cwd) {
  if (options.repo) return options.repo;
  if (config.repo) return config.repo;
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd });
    return repoFromRemote(stdout);
  } catch {
    throw new GitHubPrError('GitHub repository is missing; pass --repo or set GITHUB_REPO');
  }
}

async function currentBranch(cwd) {
  let branch;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    branch = stdout.trim();
  } catch {
    throw new GitHubPrError('cannot derive the source branch from this checkout; pass --source-branch');
  }
  if (!branch || branch === 'HEAD') throw new GitHubPrError('cannot derive the source branch; pass --source-branch');
  return branch;
}

function required(options, name) {
  if (!options[name]) throw new GitHubPrError(`--${name.replaceAll('_', '-')} is required`);
  return options[name];
}

function numberOption(options, name, fallback) {
  const value = options[name] ?? fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new GitHubPrError(`--${name.replaceAll('_', '-')} must be a positive integer`);
  return parsed;
}

function listOption(value) {
  if (value === undefined) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

async function textOption(options, inlineName, fileName) {
  if (options[inlineName] !== undefined && options[fileName] !== undefined) {
    throw new GitHubPrError(`--${inlineName.replaceAll('_', '-')} and --${fileName.replaceAll('_', '-')} are mutually exclusive`);
  }
  if (options[fileName] !== undefined) return readFile(options[fileName], 'utf8');
  return options[inlineName];
}

function extraFields(options) {
  if (options.json === undefined) return {};
  let extra;
  try {
    extra = JSON.parse(options.json);
  } catch {
    throw new GitHubPrError('--json must contain a valid JSON object');
  }
  if (!extra || Array.isArray(extra) || typeof extra !== 'object') {
    throw new GitHubPrError('--json must contain a JSON object');
  }
  return extra;
}

async function issueFields(options) {
  const fields = {};
  if (options.labels !== undefined) fields.labels = listOption(options.labels);
  if (options.assignees !== undefined) fields.assignees = listOption(options.assignees);
  return fields;
}

async function pullFields(options) {
  const fields = {};
  if (options.title !== undefined) fields.title = options.title;
  const description = await textOption(options, 'description', 'description_file');
  if (description !== undefined) fields.body = description;
  return fields;
}

function apiRoot(config, remoteHost) {
  if (config.apiUrl) {
    const configuredUrl = config.apiUrl.trim();
    let parsed;
    try {
      parsed = new URL(configuredUrl);
    } catch {
      throw new GitHubPrError('GITHUB_API_URL must be an absolute HTTP(S) URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new GitHubPrError('GITHUB_API_URL must be an absolute HTTP(S) URL without credentials or query parameters');
    }
    return configuredUrl.replace(/\/+$/u, '');
  }
  if (remoteHost === 'github.com') return 'https://api.github.com';
  return `https://${remoteHost}/api/v3`;
}

function hostFromRemote(remote) {
  const match = remote.match(/^(?:https?:\/\/|ssh:\/\/git@|git@)([^/:]+)/u);
  if (!match?.[1]) throw new GitHubPrError('cannot derive GitHub host from remote');
  return match[1];
}

async function resolveApiRoot(config, cwd) {
  if (config.apiUrl) return apiRoot(config, 'github.com');
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd });
    return apiRoot(config, hostFromRemote(stdout.trim()));
  } catch {
    return apiRoot(config, 'github.com');
  }
}

async function request({ root, repo, token, method, path, body, fetchImpl }) {
  const endpoint = `${root}/repos/${repo}${path}`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    throw new GitHubPrError(`GitHub request failed: ${cause instanceof Error ? cause.message : String(error)}`);
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = { message: text.slice(0, 500) };
  }
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : `GitHub request failed with HTTP ${response.status}`;
    throw new GitHubPrError(message);
  }
  return data;
}

/** Labels and assignees live on the issue side of a pull request; GitHub
 *  rejects them on the pull itself, so they land in a second call. */
async function applyIssueFields({ root, repo, token, number, fields, fetchImpl }) {
  if (Object.keys(fields).length === 0) return;
  await request({
    root, repo, token, method: 'PATCH',
    path: `/issues/${encodeURIComponent(number)}`,
    body: fields, fetchImpl,
  });
}

export async function run(argv, { env = process.env, cwd = process.cwd(), fetchImpl = fetch } = {}) {
  const options = parseArgs(argv);
  if (!options.command || options.command === 'help') return { help: usage() };
  const config = await loadConfig(env);
  const repo = await resolveRepo(options, config, cwd);
  const root = await resolveApiRoot(config, cwd);
  const call = (method, path, body) => request({ root, repo, token: config.token, method, path, body, fetchImpl });

  switch (options.command) {
    case 'list': {
      if (options.search !== undefined) {
        const query = new URLSearchParams({
          q: `repo:${repo} is:pr ${options.search}`,
          per_page: String(numberOption(options, 'per_page', 100)),
          page: String(numberOption(options, 'page', 1)),
        });
        return call('GET', `/search/issues?${query}`);
      }
      const query = new URLSearchParams({
        per_page: String(numberOption(options, 'per_page', 100)),
        page: String(numberOption(options, 'page', 1)),
      });
      if (options.state) query.set('state', options.state);
      if (options.source_branch) query.set('head', `${repo.split('/')[0]}:${options.source_branch}`);
      if (options.target_branch) query.set('base', options.target_branch);
      return call('GET', `/pulls?${query}`);
    }
    case 'get':
      return call('GET', `/pulls/${encodeURIComponent(required(options, 'number'))}`);
    case 'create': {
      const title = required(options, 'title');
      const head = options.source_branch ?? await currentBranch(cwd);
      const base = options.target_branch ?? 'main';
      const created = await call('POST', '/pulls', {
        title,
        head,
        base,
        ...(options.draft === true ? { draft: true } : {}),
        ...(await pullFields(options)),
        ...extraFields(options),
      });
      await applyIssueFields({
        root, repo, token: config.token, number: created.number,
        fields: await issueFields(options), fetchImpl,
      });
      return created;
    }
    case 'update': {
      const number = required(options, 'number');
      const updated = await call('PATCH', `/pulls/${encodeURIComponent(number)}`, {
        ...(await pullFields(options)),
        ...(options.target_branch !== undefined ? { base: options.target_branch } : {}),
        ...extraFields(options),
      });
      await applyIssueFields({
        root, repo, token: config.token, number,
        fields: await issueFields(options), fetchImpl,
      });
      return updated;
    }
    case 'close':
    case 'reopen':
      return call('PATCH', `/pulls/${encodeURIComponent(required(options, 'number'))}`, {
        state: options.command === 'close' ? 'closed' : 'open',
      });
    case 'comment': {
      const body = await textOption(options, 'body', 'body_file');
      if (body === undefined) throw new GitHubPrError('--body or --body-file is required');
      return call('POST', `/issues/${encodeURIComponent(required(options, 'number'))}/comments`, { body });
    }
    case 'merge': {
      if (!options.confirm) throw new GitHubPrError('merge requires --confirm');
      const number = required(options, 'number');
      let headBranch;
      if (options.remove_source_branch === true) {
        const pull = await call('GET', `/pulls/${encodeURIComponent(number)}`);
        headBranch = pull.head?.ref;
      }
      const merged = await call('PUT', `/pulls/${encodeURIComponent(number)}/merge`, {
        ...(options.merge_method !== undefined ? { merge_method: options.merge_method } : {}),
        ...extraFields(options),
      });
      if (options.remove_source_branch === true && headBranch) {
        await call('DELETE', `/git/refs/heads/${headBranch.split('/').map(encodeURIComponent).join('/')}`);
      }
      return merged;
    }
    default:
      throw new GitHubPrError(`unknown command: ${options.command}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await run(process.argv.slice(2));
    if (result?.help) process.stdout.write(result.help);
    else process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`github-pr: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
