# Draft & Manage Merge Requests

Use the bundled `scripts/gitlab-mr.mjs` program for every GitLab merge-request operation. The program reads `GITLAB_TOKEN` from `~/.claude/.env` locally and sends it only as the `PRIVATE-TOKEN` HTTP header. The agent must never read, print, interpolate, forward, or expose the token, and must never call GitLab with `curl`, `gh`, `fetch`, or another direct network tool.

## Invocation

Run from the repository root:

```sh
node .agents/skills/draft-mr/scripts/gitlab-mr.mjs <command> [options]
```

The same program is available through `.claude/skills/draft-mr/`, `.codex/skills/draft-mr/`, and `.github/skills/draft-mr/`. The project is derived from the `origin` remote, or can be supplied with `--project <path|id>`. The API root is resolved in this order: `GITLAB_API_URL`, local Git config `remote.origin.apiurl`, then HTTPS derived from the `origin` remote. Never put a token in command arguments.

Do not add an automatic HTTP fallback. An HTTP API root must be explicitly configured by the user; before a request, explain that its token header is not protected by TLS and obtain explicit approval.

## Commands

- `list`: `--state`, `--search`, `--source-branch`, `--target-branch`, `--page`, `--per-page`
- `get`: `--iid`
- `create`: `--title` (required), `--source-branch` (default: current branch), `--target-branch` (default: `main`), `--description` or `--description-file`, `--labels`, `--assignee-ids`, `--squash`, `--remove-source-branch`, `--json`
- `update`: `--iid`, any editable fields above, optional `--json`
- `close` / `reopen`: `--iid`
- `comment`: `--iid`, `--body` or `--body-file`
- `merge`: `--iid --confirm`, optional `--squash`, `--remove-source-branch`

Long markdown descriptions should come from a file via `--description-file` (UTF-8), not inline shell arguments. Parse the JSON result and report only the returned IID, URL, or a safe error. Do not echo credentials or raw request headers.

## Safety and workflow

1. Push the source branch first; the program never pushes. Confirm the target project and source/target branches before creating. `create` deduplicates nothing — check `list --source-branch` first if an MR may already exist.
2. `merge` is destructive and outward-facing: it requires the program's `--confirm` flag and the developer's explicit request to merge, plus the repo's verification gate (`npm run typecheck && npm test`) green on the branch. Report the pipeline state when visible; never merge on a red pipeline.
3. For a multi-step request, run one command at a time and verify each JSON response before continuing.
4. If credentials, remote metadata, or network access is unavailable, report the program's error and stop; never work around it with direct API access.
