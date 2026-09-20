import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
import { run } from './gitlab-issues.mjs';

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
  const directory = await mkdtemp(join(tmpdir(), 'gitlab-issues-'));
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

function fakeFetch(calls, response = { id: 1, iid: 7, web_url: 'https://gitlab.test/group/project/-/issues/7' }) {
  return async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

describe('gitlab issues program', () => {
  it('reads the token locally and creates an issue without exposing it in the request URL', async () => {
    const { env } = await testEnvironment();
    const calls = [];
    const result = await run(['create', '--title', 'New issue', '--description', 'Details'], { env, fetchImpl: fakeFetch(calls) });

    assert.equal(result.iid, 7);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://gitlab.test/api/v4/projects/group%2Fproject/issues');
    assert.equal(calls[0].options.headers['PRIVATE-TOKEN'], 'test-token');
    assert.equal(calls[0].options.body, JSON.stringify({ title: 'New issue', description: 'Details' }));
    assert.equal(calls[0].url.includes('test-token'), false);
  });

  it('lets process environment settings override values from the dotenv file', async () => {
    const { env } = await testEnvironment({
      fileValues: {
        GITLAB_API_URL: 'https://file.test/api/v4',
        GITLAB_PROJECT: 'file/project',
      },
      processEnv: {
        GITLAB_API_URL: 'https://env.test/api/v4',
        GITLAB_PROJECT: 'env/project',
      },
    });
    const calls = [];

    await run(['get', '--iid', '7'], { env, fetchImpl: fakeFetch(calls) });

    assert.equal(calls[0].url, 'https://env.test/api/v4/projects/env%2Fproject/issues/7');
  });

  it('derives the API host from the origin remote when only the project is configured', async () => {
    const { env } = await testEnvironment({ fileValues: { GITLAB_PROJECT: 'group/project' } });
    const repository = await mkdtemp(join(tmpdir(), 'gitlab-issues-repository-'));
    temporaryDirectories.push(repository);
    await execFileAsync('git', ['init', '--quiet'], { cwd: repository });
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@git.enflame.cn:group/project.git'], { cwd: repository });
    const calls = [];

    await run(['get', '--iid', '7'], { env, cwd: repository, fetchImpl: fakeFetch(calls) });

    assert.equal(calls[0].url, 'https://git.enflame.cn/api/v4/projects/group%2Fproject/issues/7');
  });

  it('uses an explicitly configured API root from the origin remote', async () => {
    const { env } = await testEnvironment({ fileValues: { GITLAB_PROJECT: 'group/project' } });
    const repository = await mkdtemp(join(tmpdir(), 'gitlab-issues-repository-'));
    temporaryDirectories.push(repository);
    await execFileAsync('git', ['init', '--quiet'], { cwd: repository });
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@gitlab.test:group/project.git'], { cwd: repository });
    await execFileAsync('git', ['config', 'remote.origin.apiurl', 'http://gitlab.test/api/v4'], { cwd: repository });
    const calls = [];

    await run(['get', '--iid', '7'], { env, cwd: repository, fetchImpl: fakeFetch(calls) });

    assert.equal(calls[0].url, 'http://gitlab.test/api/v4/projects/group%2Fproject/issues/7');
  });

  it('rejects API URLs with credentials or unsupported protocols', async () => {
    const { env } = await testEnvironment({ processEnv: { GITLAB_API_URL: 'file:///tmp/gitlab' } });

    await assert.rejects(run(['get', '--iid', '7'], { env, fetchImpl: fakeFetch([]) }), /absolute HTTP\(S\) URL/);
  });

  it('maps update, close, reopen, comment, and delete to the expected GitLab operations', async () => {
    const { env } = await testEnvironment();
    const calls = [];
    const fetchImpl = fakeFetch(calls);
    await run(['update', '--iid', '7', '--title', 'Updated'], { env, fetchImpl });
    await run(['close', '--iid', '7'], { env, fetchImpl });
    await run(['reopen', '--iid', '7'], { env, fetchImpl });
    await run(['comment', '--iid', '7', '--body', 'Comment'], { env, fetchImpl });
    await run(['delete', '--iid', '7', '--confirm'], { env, fetchImpl });

    assert.deepEqual(calls.map(({ options }) => `${options.method}:${JSON.parse(options.body ?? '{}').state_event ?? JSON.parse(options.body ?? '{}').body ?? ''}`), [
      'PUT:', 'PUT:close', 'PUT:reopen', 'POST:Comment', 'DELETE:',
    ]);
  });

  it('requires confirmation before deletion', async () => {
    const { env } = await testEnvironment();
    await assert.rejects(run(['delete', '--iid', '7'], { env, fetchImpl: fakeFetch([]) }), /requires --confirm/);
  });

  it('does not leak the token in GitLab error messages', async () => {
    const { env } = await testEnvironment();
    const fetchImpl = async () => new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 });
    await assert.rejects(run(['get', '--iid', '7'], { env, fetchImpl }), /forbidden/);
  });
});
