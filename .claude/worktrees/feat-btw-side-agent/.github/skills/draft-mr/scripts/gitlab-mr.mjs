#!/usr/bin/env node
// Generic GitLab merge-request program — the MR-side twin of
// gitlab-issues.mjs. Same credential discipline: GITLAB_TOKEN is read from
// ~/.claude/.env inside this process and sent only as the PRIVATE-TOKEN
// header; it is never printed, interpolated into output, or taken from
// command arguments. The project derives from the origin remote (or
// --project / GITLAB_PROJECT); the API root resolves in the order
// GITLAB_API_URL, local git config remote.origin.apiurl, HTTPS derived from
// the origin remote. An HTTP (non-TLS) API root must be configured
// explicitly by the user — never fall back to it silently.
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_ENV_FILE = join(homedir(), '.claude', '.env');

export class GitLabMrError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'GitLabMrError';
  }
}

function usage() {
  return `Usage: gitlab-mr <command> [options]

Commands:
  list       List merge requests
  get        Get one merge request
  create     Create a merge request
  update     Update a merge request
  close      Close a merge request
  reopen     Reopen a merge request
  comment    Add a merge request note
  merge      Accept a merge request (requires --confirm)

Common options:
  --project <path|id>       GitLab project; defaults to GITLAB_PROJECT or origin remote
  --iid <number>            Merge request IID for single-MR commands
  --source-branch <name>    Source branch (create default: current git branch)
  --target-branch <name>    Target branch (create default: main)
  --title <text>            Merge request title
  --description <text>      Description markdown
  --description-file <path> Read description markdown from a file (UTF-8)
  --body <text>             Comment body
  --body-file <path>        Read comment body from a file (UTF-8)
  --labels <a,b>            Comma-separated labels
  --assignee-ids <1,2>      Comma-separated user IDs
  --state <opened|closed|merged|locked>  List filter
  --search <text>           List search
  --page <number>           List page (default: 1)
  --per-page <number>       List size (default: 100)
  --squash                  Squash commits on create/merge
  --remove-source-branch    Delete the source branch on create/merge
  --confirm                 Required for merge
  --json <object>           Additional JSON request fields

Configuration:
  GITLAB_TOKEN is read from ~/.claude/.env (or GITLAB_ENV_FILE).
  GITLAB_API_URL or remote.origin.apiurl optionally overrides the API root;
  GITLAB_PROJECT optionally overrides project discovery.
`;
}

const BOOLEAN_OPTIONS = new Set(['confirm', 'remove_source_branch', 'squash']);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith('--')) throw new GitLabMrError(`unexpected argument: ${argument}`);
    const key = argument.slice(2).replaceAll('-', '_');
    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new GitLabMrError(`missing value for --${key.replaceAll('_', '-')}`);
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

async function loadConfig(env) {
  const envFile = env.GITLAB_ENV_FILE || DEFAULT_ENV_FILE;
  let text;
  try {
    text = await readFile(envFile, 'utf8');
  } catch {
    throw new GitLabMrError(`cannot read GitLab credentials from ${envFile}`);
  }
  const fileValues = parseDotEnv(text);
  const token = fileValues.GITLAB_TOKEN;
  if (!token) throw new GitLabMrError(`GITLAB_TOKEN is missing in ${envFile}`);
  return {
    token,
    apiUrl: env.GITLAB_API_URL ?? fileValues.GITLAB_API_URL,
    project: env.GITLAB_PROJECT ?? fileValues.GITLAB_PROJECT,
  };
}

function projectFromRemote(remote) {
  const value = remote.trim().replace(/\.git$/u, '');
  const match = value.match(/^(?:https?:\/\/[^/]+\/|ssh:\/\/git@[^/]+\/|git@[^:]+:)(.+)$/u);
  if (!match?.[1]) throw new GitLabMrError('cannot derive GitLab project path from remote');
  return match[1];
}

async function resolveProject(options, config, cwd) {
  if (options.project) return options.project;
  if (config.project) return config.project;
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd });
    return projectFromRemote(stdout);
  } catch {
    throw new GitLabMrError('GitLab project is missing; pass --project or set GITLAB_PROJECT');
  }
}

async function currentBranch(cwd) {
  let branch;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    branch = stdout.trim();
  } catch {
    throw new GitLabMrError('cannot derive the source branch from this checkout; pass --source-branch');
  }
  if (!branch || branch === 'HEAD') throw new GitLabMrError('cannot derive the source branch; pass --source-branch');
  return branch;
}

function required(options, name) {
  if (!options[name]) throw new GitLabMrError(`--${name.replaceAll('_', '-')} is required`);
  return options[name];
}

function numberOption(options, name, fallback) {
  const value = options[name] ?? fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new GitLabMrError(`--${name.replaceAll('_', '-')} must be a positive integer`);
  return parsed;
}

function listOption(value) {
  if (value === undefined) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

async function textOption(options, inlineName, fileName) {
  if (options[inlineName] !== undefined && options[fileName] !== undefined) {
    throw new GitLabMrError(`--${inlineName.replaceAll('_', '-')} and --${fileName.replaceAll('_', '-')} are mutually exclusive`);
  }
  if (options[fileName] !== undefined) return readFile(options[fileName], 'utf8');
  return options[inlineName];
}

async function requestFields(options) {
  const fields = {};
  if (options.title !== undefined) fields.title = options.title;
  const description = await textOption(options, 'description', 'description_file');
  if (description !== undefined) fields.description = description;
  if (options.labels !== undefined) fields.labels = options.labels;
  if (options.assignee_ids !== undefined) {
    const assigneeIds = listOption(options.assignee_ids).map(Number);
    if (assigneeIds.some((id) => !Number.isInteger(id) || id < 1)) {
      throw new GitLabMrError('--assignee-ids must contain positive integers');
    }
    fields.assignee_ids = assigneeIds;
  }
  if (options.target_branch !== undefined) fields.target_branch = options.target_branch;
  if (options.remove_source_branch === true) fields.remove_source_branch = true;
  if (options.squash === true) fields.squash = true;
  if (options.json !== undefined) {
    let extra;
    try {
      extra = JSON.parse(options.json);
    } catch {
      throw new GitLabMrError('--json must contain a valid JSON object');
    }
    if (!extra || Array.isArray(extra) || typeof extra !== 'object') {
      throw new GitLabMrError('--json must contain a JSON object');
    }
    Object.assign(fields, extra);
  }
  return fields;
}

function apiRoot(config, remoteHost) {
  if (!config.apiUrl) return `https://${remoteHost}/api/v4`;
  const configuredUrl = config.apiUrl.trim();
  let parsed;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new GitLabMrError('GITLAB_API_URL must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new GitLabMrError('GITLAB_API_URL must be an absolute HTTP(S) URL without credentials or query parameters');
  }
  return configuredUrl.replace(/\/+$/u, '');
}

function hostFromRemote(remote) {
  const match = remote.match(/^(?:https?:\/\/|ssh:\/\/git@|git@)([^/:]+)/u);
  if (!match?.[1]) throw new GitLabMrError('cannot derive GitLab host from remote');
  return match[1];
}

async function resolveApiRoot(config, cwd) {
  if (config.apiUrl) return apiRoot(config, 'gitlab.com');
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.apiurl'], { cwd });
    const configuredUrl = stdout.trim();
    if (configuredUrl) return apiRoot({ ...config, apiUrl: configuredUrl }, 'gitlab.com');
  } catch {
    // The repository may not have an explicit API root; derive HTTPS from its remote.
  }
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd });
    return apiRoot(config, hostFromRemote(stdout.trim()));
  } catch {
    return apiRoot(config, 'gitlab.com');
  }
}

async function request({ root, project, token, method, path, body, fetchImpl }) {
  const endpoint = `${root}/projects/${encodeURIComponent(project)}${path}`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': token,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    throw new GitLabMrError(`GitLab request failed: ${cause instanceof Error ? cause.message : String(error)}`);
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = { message: text.slice(0, 500) };
  }
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : `GitLab request failed with HTTP ${response.status}`;
    throw new GitLabMrError(message);
  }
  return data;
}

export async function run(argv, { env = process.env, cwd = process.cwd(), fetchImpl = fetch } = {}) {
  const options = parseArgs(argv);
  if (!options.command || options.command === 'help') return { help: usage() };
  const config = await loadConfig(env);
  const project = await resolveProject(options, config, cwd);
  const root = await resolveApiRoot(config, cwd);

  switch (options.command) {
    case 'list': {
      const query = new URLSearchParams({ page: String(numberOption(options, 'page', 1)), per_page: String(numberOption(options, 'per_page', 100)) });
      if (options.state) query.set('state', options.state);
      if (options.search) query.set('search', options.search);
      if (options.source_branch) query.set('source_branch', options.source_branch);
      if (options.target_branch) query.set('target_branch', options.target_branch);
      return request({ root, project, token: config.token, method: 'GET', path: `/merge_requests?${query}`, fetchImpl });
    }
    case 'get':
      return request({ root, project, token: config.token, method: 'GET', path: `/merge_requests/${encodeURIComponent(required(options, 'iid'))}`, fetchImpl });
    case 'create': {
      const title = required(options, 'title');
      const sourceBranch = options.source_branch ?? await currentBranch(cwd);
      const targetBranch = options.target_branch ?? 'main';
      return request({
        root, project, token: config.token, method: 'POST', path: '/merge_requests',
        body: { title, source_branch: sourceBranch, target_branch: targetBranch, ...await requestFields(options) },
        fetchImpl,
      });
    }
    case 'update':
      return request({ root, project, token: config.token, method: 'PUT', path: `/merge_requests/${encodeURIComponent(required(options, 'iid'))}`, body: await requestFields(options), fetchImpl });
    case 'close':
    case 'reopen':
      return request({ root, project, token: config.token, method: 'PUT', path: `/merge_requests/${encodeURIComponent(required(options, 'iid'))}`, body: { state_event: options.command === 'close' ? 'close' : 'reopen' }, fetchImpl });
    case 'comment': {
      const body = await textOption(options, 'body', 'body_file');
      if (body === undefined) throw new GitLabMrError('--body or --body-file is required');
      return request({ root, project, token: config.token, method: 'POST', path: `/merge_requests/${encodeURIComponent(required(options, 'iid'))}/notes`, body: { body }, fetchImpl });
    }
    case 'merge': {
      if (!options.confirm) throw new GitLabMrError('merge requires --confirm');
      return request({
        root, project, token: config.token, method: 'PUT', path: `/merge_requests/${encodeURIComponent(required(options, 'iid'))}/merge`,
        body: {
          ...(options.squash === true ? { squash: true } : {}),
          ...(options.remove_source_branch === true ? { should_remove_source_branch: true } : {}),
          ...(options.json !== undefined ? JSON.parse(options.json) : {}),
        },
        fetchImpl,
      });
    }
    default:
      throw new GitLabMrError(`unknown command: ${options.command}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await run(process.argv.slice(2));
    if (result?.help) process.stdout.write(result.help);
    else process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`gitlab-mr: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
