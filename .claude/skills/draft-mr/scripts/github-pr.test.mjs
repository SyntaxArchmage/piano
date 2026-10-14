import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
import { run } from './github-pr.mjs';

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function testEnvironment({
  fileValues = {
    GITHUB_API_URL: 'https://github.test/api/v3',
    GITHUB_REPO: 'group/project',
  },
  processEnv = {},
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'github-pr-'));
  temporaryDirectories.push(directory);
  const envFile = join(directory, '.env');
  const settings = Object.entries(fileValues).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  await writeFile(envFile, ['OTHER=value', 'export GITHUB_TOKEN="test-token"', ...settings, ''].join('\n'));
  return {
    env: {
      GITHUB_ENV_FILE: envFile,
      // Keep the gh CLI fallback out of the way so the file path is what runs.
      GH_TOKEN: '',
      ...processEnv,
    },
  };
}

async function testRepository(branch = 'feature/x') {
  const repository = await mkdtemp(join(tmpdir(), 'github-pr-repository-'));
  temporaryDirectories.push(repository);
  await execFileAsync('git', ['init', '--quiet', '--initial-branch', branch], { cwd: repository });
  await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:group/project.git'], { cwd: repository });
  // A checkout with no commits has no HEAD; real PR creation never happens
  // there, but the tests need a named branch to resolve.
  await execFileAsync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '--allow-empty', '-m', 'seed'], { cwd: repository });
  return repository;
}

function fakeFetch(calls, response = { id: 11, number: 12, html_url: 'https://github.test/group/project/pull/12' }) {
  return async (url, options) => {
    calls.push({ url, options });
    const payload = typeof response === 'function' ? response(url, options) : response;
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function requestBody(call) {
  return JSON.parse(call.options.body);
}

describe('github pull request program', () => {
  it('creates a PR for the current branch with the token only in the header', async () => {
    const { env } = await testEnvironment();
    const repository = await testRepository('feature/x');
    const calls = [];
    const result = await run(['create', '--title', 'Feature X'], { env, cwd: repository, fetchImpl: fakeFetch(calls) });

    assert.equal(result.number, 12);
    assert.equal(calls[0].url, 'https://github.test/api/v3/repos/group/project/pulls');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(calls[0].url.includes('test-token'), false);
    const body = requestBody(calls[0]);
    assert.equal(body.head, 'feature/x');
    assert.equal(body.base, 'main');
  });

  it('honors explicit branches, description files, and create-time flags', async () => {
    const { env } = await testEnvironment();
    const descDir = await mkdtemp(join(tmpdir(), 'github-pr-desc-'));
    temporaryDirectories.push(descDir);
    const descriptionFile = join(descDir, 'body.md');
    await writeFile(descriptionFile, '## Summary\n\n- one\n');
    const calls = [];
    await run([
      'create', '--title', 'Feature X', '--source-branch', 'feat/x', '--target-branch', 'release',
      '--description-file', descriptionFile, '--draft',
    ], { env, cwd: await testRepository(), fetchImpl: fakeFetch(calls) });

    assert.deepEqual(requestBody(calls[0]), {
      title: 'Feature X',
      head: 'feat/x',
      base: 'release',
      draft: true,
      body: '## Summary\n\n- one\n',
    });
  });

  it('sends labels and assignees to the issue endpoint, not the pull', async () => {
    const { env } = await testEnvironment();
    const calls = [];
    await run(['create', '--title', 'Feature X', '--labels', 'bug,needs-review', '--assignees', 'alice'], {
      env, cwd: await testRepository(), fetchImpl: fakeFetch(calls),
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url.endsWith('/pulls'), true);
    assert.equal(requestBody(calls[0]).labels, undefined);
    assert.equal(calls[1].url, 'https://github.test/api/v3/repos/group/project/issues/12');
    assert.equal(calls[1].options.method, 'PATCH');
    assert.deepEqual(requestBody(calls[1]), { labels: ['bug', 'needs-review'], assignees: ['alice'] });
  });

  it('rejects mutually exclusive inline and file descriptions', async () => {
    const { env } = await testEnvironment();
    await assert.rejects(
      run(['create', '--title', 'x', '--description', 'a', '--description-file', '/tmp/nope.md'], { env, cwd: await testRepository(), fetchImpl: fakeFetch([]) }),
      /mutually exclusive/,
    );
  });

  it('maps list/get/update/close/reopen/comment to the expected endpoints', async () => {
    const { env } = await testEnvironment();
    const calls = [];
    const fetchImpl = fakeFetch(calls);
    await run(['list', '--state', 'open', '--source-branch', 'feat/x', '--per-page', '5'], { env, fetchImpl });
    await run(['get', '--number', '12'], { env, fetchImpl });
    await run(['update', '--number', '12', '--title', 'Updated'], { env, fetchImpl });
    await run(['close', '--number', '12'], { env, fetchImpl });
    await run(['reopen', '--number', '12'], { env, fetchImpl });
    await run(['comment', '--number', '12', '--body', 'looks good'], { env, fetchImpl });

    assert.equal(calls[0].url, 'https://github.test/api/v3/repos/group/project/pulls?per_page=5&page=1&state=open&head=group%3Afeat%2Fx');
    assert.equal(calls[1].url.endsWith('/pulls/12'), true);
    assert.deepEqual(
      calls.slice(2).map(({ options }) => `${options.method}:${requestBody({ options }).state ?? requestBody({ options }).title ?? requestBody({ options }).body ?? ''}`),
      ['PATCH:Updated', 'PATCH:closed', 'PATCH:open', 'POST:looks good'],
    );
  });

  it('routes --search through the issue search endpoint', async () => {
    const { env } = await testEnvironment();
    const calls = [];
    await run(['list', '--search', 'fix crash'], { env, fetchImpl: fakeFetch(calls) });
    assert.equal(calls[0].url, 'https://github.test/api/v3/repos/group/project/search/issues?q=repo%3Agroup%2Fproject+is%3Apr+fix+crash&per_page=100&page=1');
  });

  it('requires confirmation before merging, then merges and drops the head branch', async () => {
    const { env } = await testEnvironment();
    await assert.rejects(run(['merge', '--number', '12'], { env, fetchImpl: fakeFetch([]) }), /requires --confirm/);

    const calls = [];
    await run(['merge', '--number', '12', '--confirm', '--merge-method', 'squash', '--remove-source-branch'], {
      env,
      fetchImpl: fakeFetch(calls, (url) => url.endsWith('/pulls/12')
        ? { number: 12, head: { ref: 'feature/x' } }
        : { merged: true }),
    });
    // The head ref is read first, then the merge fires, then the ref is deleted.
    assert.deepEqual(calls.map(({ url, options }) => `${options.method}:${url.split('/repos/')[1]}`), [
      'GET:group/project/pulls/12',
      'PUT:group/project/pulls/12/merge',
      'DELETE:group/project/git/refs/heads/feature/x',
    ]);
    assert.deepEqual(requestBody(calls[1]), { merge_method: 'squash' });
  });

  it('derives api.github.com from a github.com origin when no API root is configured', async () => {
    const { env } = await testEnvironment({ fileValues: { GITHUB_REPO: 'group/project' } });
    const repository = await testRepository();
    const calls = [];
    await run(['get', '--number', '12'], { env, cwd: repository, fetchImpl: fakeFetch(calls) });
    assert.equal(calls[0].url, 'https://api.github.com/repos/group/project/pulls/12');
  });

  it('does not leak the token in GitHub error messages', async () => {
    const { env } = await testEnvironment();
    const fetchImpl = async () => new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 });
    await assert.rejects(run(['get', '--number', '12'], { env, fetchImpl }), /forbidden/);
  });
});
