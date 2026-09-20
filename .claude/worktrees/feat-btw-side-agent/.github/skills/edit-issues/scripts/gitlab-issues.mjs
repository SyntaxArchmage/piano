#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_ENV_FILE = join(homedir(), '.claude', '.env');

export class GitLabIssuesError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'GitLabIssuesError';
  }
}

function usage() {
  return `Usage: gitlab-issues <command> [options]

Commands:
  list       List issues
  get        Get one issue
  create     Create an issue
  update     Update an issue
  close      Close an issue
  reopen     Reopen an issue
  comment    Add an issue note
  delete     Delete an issue (requires --confirm)

Common options:
  --project <path|id>       GitLab project; defaults to GITLAB_PROJECT or origin remote
  --iid <number>            Issue IID for single-issue commands
  --title <text>            Issue title
  --description <text>      Issue description
  --body <text>             Comment body
  --labels <a,b>            Comma-separated labels
  --assignee-ids <1,2>      Comma-separated user IDs
  --state <opened|closed>   List filter
  --search <text>           List search
  --page <number>           List page (default: 1)
  --per-page <number>       List size (default: 100)
  --confirm                 Required for delete
  --json <object>           Additional JSON request fields

Configuration:
  GITLAB_TOKEN is read from ~/.claude/.env (or GITLAB_ENV_FILE).
  GITLAB_API_URL or remote.origin.apiurl optionally overrides the API root;
  GITLAB_PROJECT optionally overrides project discovery.
`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith('--')) throw new GitLabIssuesError(`unexpected argument: ${argument}`);
    const key = argument.slice(2).replaceAll('-', '_');
    if (key === 'confirm') {
      options[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new GitLabIssuesError(`missing value for --${key.replaceAll('_', '-')}`);
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
    throw new GitLabIssuesError(`cannot read GitLab credentials from ${envFile}`);
  }
  const fileValues = parseDotEnv(text);
  const token = fileValues.GITLAB_TOKEN;
  if (!token) throw new GitLabIssuesError(`GITLAB_TOKEN is missing in ${envFile}`);
  return {
    token,
    apiUrl: env.GITLAB_API_URL ?? fileValues.GITLAB_API_URL,
    project: env.GITLAB_PROJECT ?? fileValues.GITLAB_PROJECT,
  };
}

function projectFromRemote(remote) {
  const value = remote.trim().replace(/\.git$/u, '');
  const match = value.match(/^(?:https?:\/\/[^/]+\/|ssh:\/\/git@[^/]+\/|git@[^:]+:)(.+)$/u);
  if (!match?.[1]) throw new GitLabIssuesError('cannot derive GitLab project path from remote');
  return match[1];
}

async function resolveProject(options, config, cwd) {
  if (options.project) return options.project;
  if (config.project) return config.project;
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd });
    return projectFromRemote(stdout);
  } catch {
    throw new GitLabIssuesError('GitLab project is missing; pass --project or set GITLAB_PROJECT');
  }
}

function required(options, name) {
  if (!options[name]) throw new GitLabIssuesError(`--${name.replaceAll('_', '-')} is required`);
  return options[name];
}

function numberOption(options, name, fallback) {
  const value = options[name] ?? fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new GitLabIssuesError(`--${name.replaceAll('_', '-')} must be a positive integer`);
  return parsed;
}

function listOption(value) {
  if (value === undefined) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function requestFields(options, includeStateEvent = false) {
  const fields = {};
  if (options.title !== undefined) fields.title = options.title;
  if (options.description !== undefined) fields.description = options.description;
  if (options.labels !== undefined) fields.labels = options.labels;
  if (options.assignee_ids !== undefined) {
    const assigneeIds = listOption(options.assignee_ids).map(Number);
    if (assigneeIds.some((id) => !Number.isInteger(id) || id < 1)) {
      throw new GitLabIssuesError('--assignee-ids must contain positive integers');
    }
    fields.assignee_ids = assigneeIds;
  }
  if (includeStateEvent && options.state_event !== undefined) fields.state_event = options.state_event;
  if (options.json !== undefined) {
    let extra;
    try {
      extra = JSON.parse(options.json);
    } catch {
      throw new GitLabIssuesError('--json must contain a valid JSON object');
    }
    if (!extra || Array.isArray(extra) || typeof extra !== 'object') {
      throw new GitLabIssuesError('--json must contain a JSON object');
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
    throw new GitLabIssuesError('GITLAB_API_URL must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new GitLabIssuesError('GITLAB_API_URL must be an absolute HTTP(S) URL without credentials or query parameters');
  }
  return configuredUrl.replace(/\/+$/u, '');
}

function hostFromRemote(remote) {
  const match = remote.match(/^(?:https?:\/\/|ssh:\/\/git@|git@)([^/:]+)/u);
  if (!match?.[1]) throw new GitLabIssuesError('cannot derive GitLab host from remote');
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
    const causeMessage = cause instanceof Error && cause.message ? cause.message : '';
    const reason = causeMessage || (error instanceof Error && error.message) || '';
    const suffix = reason ? `: ${reason}` : '';
    throw new GitLabIssuesError(`GitLab request failed for ${root}${suffix}`);
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
    throw new GitLabIssuesError(message);
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
      return request({ root, project, token: config.token, method: 'GET', path: `/issues?${query}`, fetchImpl });
    }
    case 'get':
      return request({ root, project, token: config.token, method: 'GET', path: `/issues/${encodeURIComponent(required(options, 'iid'))}`, fetchImpl });
    case 'create': {
      const title = required(options, 'title');
      return request({ root, project, token: config.token, method: 'POST', path: '/issues', body: { title, ...requestFields(options) }, fetchImpl });
    }
    case 'update':
      return request({ root, project, token: config.token, method: 'PUT', path: `/issues/${encodeURIComponent(required(options, 'iid'))}`, body: requestFields(options, true), fetchImpl });
    case 'close':
    case 'reopen':
      return request({ root, project, token: config.token, method: 'PUT', path: `/issues/${encodeURIComponent(required(options, 'iid'))}`, body: { state_event: options.command === 'close' ? 'close' : 'reopen' }, fetchImpl });
    case 'comment':
      return request({ root, project, token: config.token, method: 'POST', path: `/issues/${encodeURIComponent(required(options, 'iid'))}/notes`, body: { body: required(options, 'body') }, fetchImpl });
    case 'delete':
      if (!options.confirm) throw new GitLabIssuesError('delete requires --confirm');
      return request({ root, project, token: config.token, method: 'DELETE', path: `/issues/${encodeURIComponent(required(options, 'iid'))}`, fetchImpl });
    default:
      throw new GitLabIssuesError(`unknown command: ${options.command}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await run(process.argv.slice(2));
    if (result?.help) process.stdout.write(result.help);
    else process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`gitlab-issues: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
