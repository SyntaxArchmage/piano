# Draft & Manage Pull Requests

Use the bundled `scripts/github-pr.mjs` program for every GitHub pull-request operation. The program reads `GITHUB_TOKEN` from `~/.claude/.env` (falling back to `gh auth token`) locally and sends it only as the `Authorization: Bearer` header. The agent must never read, print, interpolate, forward, or expose the token, and must never call GitHub with `curl`, `gh`, `fetch`, or another direct network tool.

## Invocation

Run from the repository root:

```sh
node .agents/skills/draft-mr/scripts/github-pr.mjs <command> [options]
```

The same program is available through `.claude/skills/draft-mr/`, `.codex/skills/draft-mr/`, and `.github/skills/draft-mr/`. The repository is derived from the `origin` remote, or can be supplied with `--repo <owner/name>`. The API root is resolved in this order: `GITHUB_API_URL`, `api.github.com` for a github.com remote, then `https://HOST/api/v3` derived from the `origin` remote. Never put a token in command arguments.

Do not add an automatic HTTP fallback. An HTTP API root must be explicitly configured by the user; before a request, explain that its token header is not protected by TLS and obtain explicit approval.

## Commands

- `list`: `--state`, `--search`, `--source-branch`, `--target-branch`, `--page`, `--per-page`
- `get`: `--number`
- `create`: `--title` (required), `--source-branch` (default: current branch), `--target-branch` (default: `main`), `--description` or `--description-file`, `--labels`, `--assignees`, `--draft`, `--json`
- `update`: `--number`, any editable fields above, optional `--json`
- `close` / `reopen`: `--number`
- `comment`: `--number`, `--body` or `--body-file`
- `merge`: `--number --confirm`, optional `--merge-method`, `--remove-source-branch`, `--json`

Long markdown descriptions should come from a file via `--description-file` (UTF-8), not inline shell arguments. Parse the JSON result and report only the returned number, URL, or a safe error. Do not echo credentials or raw request headers.

## Safety and workflow

1. Push the source branch first; the program never pushes. Confirm the repository and source/target branches before creating. `create` deduplicates nothing — check `list --source-branch` first if a PR may already exist.
2. `merge` is destructive and outward-facing: it requires the program's `--confirm` flag and the developer's explicit request to merge, plus the repo's verification gate (`npm run typecheck && npm test`) green on the branch. Report the pipeline state when visible; never merge on a red pipeline.
3. A solo author cannot approve their own PR. When branch protection requires N approving reviews and the repository has one maintainer, the PR is unmergeable and stays open forever. Setting protection on such a repo means `required_approving_review_count: 0` (plus no force-push, no deletion) — or a second human reviewer. Ask which the developer wants before flipping the rule; never assume reviews will appear.
4. For a multi-step request, run one command at a time and verify each JSON response before continuing.
5. If credentials, remote metadata, or network access is unavailable, report the program's error and stop; never work around it with direct API access.
