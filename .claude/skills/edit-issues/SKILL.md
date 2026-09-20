---
name: edit-issues
description: "Use when the user asks to edit, update, create, close, reopen, comment on, list, inspect, or delete GitLab issues. Always call the bundled local program; never access GitLab directly or pass GITLAB_TOKEN to an agent tool."
---

# Edit GitLab Issues

Use the bundled `scripts/gitlab-issues.mjs` program for every GitLab issue operation. The program reads `GITLAB_TOKEN` from `~/.claude/.env` locally and sends it only as the `PRIVATE-TOKEN` HTTP header. The agent must never read, print, interpolate, forward, or expose the token, and must never call GitLab with `curl`, `gh`, `fetch`, or another direct network tool.

## Invocation

Run from the repository root:

```sh
node .agents/skills/edit-issues/scripts/gitlab-issues.mjs <command> [options]
```

The same program is available through `.claude/skills/edit-issues/`, `.codex/skills/edit-issues/`, and `.github/skills/edit-issues/`. The project is derived from the `origin` remote, or can be supplied with `--project <path>`. The API root is resolved in this order: `GITLAB_API_URL`, local Git config `remote.origin.apiurl`, then HTTPS derived from the `origin` remote. Never put a token in command arguments.

Do not add an automatic HTTP fallback. An HTTP API root must be explicitly configured by the user; before a request, explain that its token header is not protected by TLS and obtain explicit approval.

Supported commands:

- `list`: `--state`, `--search`, `--page`, `--per-page`
- `get`: `--iid`
- `create`: `--title`, optional `--description`, `--labels`, `--assignee-ids`, `--json`
- `update`: `--iid`, any editable fields above, optional `--json`
- `close` / `reopen`: `--iid`
- `comment`: `--iid`, `--body`
- `delete`: `--iid --confirm`

Pass issue content as arguments or use `--json` for additional GitLab API fields. Parse the JSON result and report only the returned issue data, IID, URL, or a safe error. Do not echo credentials or raw request headers.

## Safety and workflow

1. Confirm the target project and issue IID before mutations. For destructive delete, require explicit user intent and the program's `--confirm` flag.
2. For a multi-step request, run one command at a time and verify each JSON response before continuing.
3. Do not close or delete unrelated issues. Do not alter local `ISSUES.md` unless separately requested.
4. If credentials, remote metadata, or network access is unavailable, report the program's error and stop; never work around it with direct API access.
