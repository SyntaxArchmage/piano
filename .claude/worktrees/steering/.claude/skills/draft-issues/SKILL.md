---
name: draft-issues
description: "Use when the user wants to turn an idea or discussion into well-scoped GitLab issues through an interactive discovery and challenge process, then submit the agreed issue set to the repository's GitLab remote."
---

# Draft Issues

Guide a discovery conversation inspired by the mechanisms of wayfinding and grilling: clarify the destination, expose assumptions, test alternatives, and make the user decide unresolved product questions. Do not copy another project's skill text or pretend a rough request is settled.

## Conversation contract

1. Inspect repository guidance, existing open GitLab issues, and relevant code/docs only enough to establish context. Do not modify code.
2. Ask focused questions in small rounds about users, problem, desired outcome, scope, non-goals, constraints, acceptance evidence, priority, dependencies, and rollout. Challenge ambiguous requirements with concrete scenarios and failure cases.
3. Reflect back the proposed decision after each round. Keep a decision ledger: agreed facts, rejected alternatives, open questions, and assumptions requiring validation. Continue until the user has resolved design questions or explicitly accepts them as assumptions.
4. Convert the agreed result into implementation-ready issues: one coherent outcome per issue, context, scope, non-goals, dependencies, acceptance criteria, validation evidence, and suggested priority. Preserve user language where it is authoritative and avoid implementation detail that was not agreed.
5. Show the final issue set for confirmation before submission. Do not create issues from an unconfirmed draft.
6. After confirmation, submit the agreed issue set through the GitLab submission steps below.

## GitLab submission

After confirmation, submit each issue through the bundled `edit-issues` program described in the `edit-issues` skill (never call GitLab with `curl` or another direct network tool, and never read, print, or pass `GITLAB_TOKEN` yourself). Use one `create` invocation per issue, capture the returned issue IID/URL, and verify each created issue. If the token, remote, or network is unavailable, stop with the exact blocker and leave the confirmed issue text ready for retry.

### `glab` is not usable on this machine

`glab` (installed as a snap package) fails with `/system.slice/ssh.service is not a snap cgroup for tag snap.glab.glab` on every invocation — do not attempt to use it. Use `gitlab-issues.mjs` directly instead.

The `git.enflame.cn` GitLab instance does not accept HTTPS connections (port 443 refused); HTTP must be used. Before running any `gitlab-issues.mjs` command, confirm with the user that HTTP is acceptable for this request, then set the API root explicitly:

```sh
GITLAB_API_URL=http://git.enflame.cn/api/v4 \
  node .claude/skills/edit-issues/scripts/gitlab-issues.mjs <command> [options]
```

Alternatively, configure it once per repo clone so the env var is not needed on every call:

```sh
git config remote.origin.apiurl http://git.enflame.cn/api/v4
```

Do not commit code for issue drafting unless the user explicitly asks for documentation changes. Never close or edit unrelated issues without permission, or claim submission without API confirmation.
