import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
import { run } from './gitlab-mr.mjs';

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function testEnvironment({
  fileValues = {
    GITLAB_API_URL: 'https://gitlab.test/api/v4',
    GITLAB_PROJECT: 'group/project',
  },
  processEnv = {},
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'gitlab-mr-'));
  temporaryDirectories.push(directory);
  const envFile = join(directory, '.env');
  const settings = Object.entries(fileValues).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  await writeFile(envFile, ['OTHER=value', 'export GITLAB_TOKEN="test-token"', ...settings, ''].join('\n'));
  return {
    env: {
      GITLAB_ENV_FILE: envFile,
      ...processEnv,
    },
  };
}

async function testRepository(branch = 'feature/x') {
  const repository = await mkdtemp(join(tmpdir(), 'gitlab-mr-repository-'));
  temporaryDirectories.push(repository);
  await execFileAsync('git', ['init', '--quiet', '--initial-branch', branch], { cwd: repository });
  await execFileAsync('git', ['remote', 'add', 'origin', 'git@git.enflame.cn:group/project.git'], { cwd: repository });
  // A checkout with no commits has no HEAD; real MR creation never happens
  // there, but the tests need a named branch to resolve.
  await execFileAsync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '--allow-empty', '-m', 'seed'], { cwd: repository });
  return repository;
}

function fakeFetch(calls, response = { id: 11, iid: 12, web_url: 'https://gitlab.test/group/project/-/merge_requests/12' }) {
  return async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

describe('gitlab merge request program', () => {
  it('creates an MR for the current branch with the token only in the header', async () => {
    const { env } = await testEnvironment();
    const repository = await testRepository('feature/x');
    const calls = [];
    const result = await run(['create', '--title', 'Feature X'], { env, cwd: repository, fetchImpl: fakeFetch(calls) });

    assert.equal(result.iid, 12);
    assert.equal(calls[0].url, 'https://gitlab.test/api/v4/projects/group%2Fproject/merge_requests');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['PRIVATE-TOKEN'], 'test-token');
    assert.equal(calls[0].url.includes('test-token'), false);
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.source_branch, 'feature/x');
    assert.equal(body.target_branch, 'main');
  });

  it('honors explicit branches, description files, and create-time flags', async () => {
    const { env } = await testEnvironment();
    const descDir = await mkdtemp(join(tmpdir(), 'gitlab-mr-desc-'));
    temporaryDirectories.push(descDir);
    const descriptionFile = join(descDir, 'body.md');
    await writeFile(descriptionFile, '## Summary\n\n- one\n');
    const calls = [];
    await run([
      'create', '--title', 'Feature X', '--source-branch', 'feat/x', '--target-branch', 'release',
      '--description-file', descriptionFile, '--remove-source-branch', '--squash',
    ], { env, cwd: await testRepository(), fetchImpl: fakeFetch(calls) });

    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(body, {
      title: 'Feature X',
      source_branch: 'feat/x',
      target_branch: 'release',
      description: '## Summary\n\n- one\n',
      remove_source_branch: true,
      squash: true,
    });
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
    await run(['list', '--state', 'opened', '--source-branch', 'feat/x', '--per-page', '5'], { env, fetchImpl });
    await run(['get', '--iid', '12'], { env, fetchImpl });
    await run(['update', '--iid', '12', '--title', 'Updated'], { env, fetchImpl });
    await run(['close', '--iid', '12'], { env, fetchImpl });
    await run(['reopen', '--iid', '12'], { env, fetchImpl });
    await run(['comment', '--iid', '12', '--body', 'looks good'], { env, fetchImpl });

    assert.equal(calls[0].url, 'https://gitlab.test/api/v4/projects/group%2Fproject/merge_requests?page=1&per_page=5&state=opened&source_branch=feat%2Fx');
    assert.equal(calls[1].url.endsWith('/merge_requests/12'), true);
    assert.deepEqual(
      calls.slice(2).map(({ options }) => `${options.method}:${JSON.parse(options.body).state_event ?? JSON.parse(options.body).body ?? ''}`),
      ['PUT:', 'PUT:close', 'PUT:reopen', 'POST:looks good'],
    );
  });

  it('requires confirmation before merging, then merges with flags', async () => {
    const { env } = await testEnvironment();
    await assert.rejects(run(['merge', '--iid', '12'], { env, fetchImpl: fakeFetch([]) }), /requires --confirm/);

    const calls = [];
    await run(['merge', '--iid', '12', '--confirm', '--squash', '--remove-source-branch'], { env, fetchImpl: fakeFetch(calls) });
    assert.equal(calls[0].url.endsWith('/merge_requests/12/merge'), true);
    assert.equal(calls[0].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0].options.body), { squash: true, should_remove_source_branch: true });
  });

  it('derives the API root from the origin remote when only the project is configured', async () => {
    const { env } = await testEnvironment({ fileValues: { GITLAB_PROJECT: 'group/project' } });
    const repository = await testRepository();
    const calls = [];
    await run(['get', '--iid', '12'], { env, cwd: repository, fetchImpl: fakeFetch(calls) });
    assert.equal(calls[0].url, 'https://git.enflame.cn/api/v4/projects/group%2Fproject/merge_requests/12');
  });

  it('does not leak the token in GitLab error messages', async () => {
    const { env } = await testEnvironment();
    const fetchImpl = async () => new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 });
    await assert.rejects(run(['get', '--iid', '12'], { env, fetchImpl }), /forbidden/);
  });
});
