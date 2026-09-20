# Real Claude and DeepSeek Harness Usage — PRD

- Status: **Proposed**
- Date: 2026-09-02
- Scope: Claude Code and the official DeepSeek Harness (`dsh`)

## 1. Summary

Piano can run a workflow through two independently installed agent harnesses:

1. Claude Code, invoked as Claude's own command-line harness.
2. The official DeepSeek Harness, invoked as its own `dsh` command.

Piano must prove that these harnesses are usable in the current machine through
real execution, rather than treating executable discovery or mocked tests as
evidence of support. During a Piano tuning mission, Piano may temporarily apply
the mission's provider, model, and credential configuration to the harnesses.
The user's existing harness configuration is backed up before the mission,
restored when the mission leaves, and never becomes a permanent change to the
user's daily setup.

Pi is an independent existing harness. It is not the implementation model,
fallback, subprocess, or configuration owner for `dsh`.

## 2. Problem

The current platform can report that a subprocess exists without proving that
it can perform useful work. A command may be installed but unusable because of
missing credentials, incompatible configuration, an unavailable model, or a
provider failure. Existing smoke coverage also risks passing after observing a
process or a `READY` string without proving that the requested task was
actually completed.

Users also commonly keep personal Claude and DeepSeek Harness settings for
daily work. Piano needs different provider or credential settings for a tuning
mission, but must not leave those settings active after the mission ends.

## 3. Goals

1. Detect Claude and the official `dsh` executable as separate native
   harnesses.
2. Let `doctor` report installation, startup, configuration, and real model
   availability with evidence from the actual harness.
3. Run a verifiable task through each harness using a real LLM call and prove
   that the task result was produced.
4. Apply Piano's mission configuration only for the lifetime of the mission.
5. Restore the user's exact prior harness configuration on every supported exit
   path, including normal completion, `/exit`, cancellation, failure, and
   SIGINT/SIGTERM shutdown.
6. Keep installation and login as explicit human environment setup, documented
   for users but never performed programmatically by Piano.

## 4. Non-goals

1. Installing, upgrading, logging into, or repairing Claude or `dsh` from
   Piano.
2. Treating `dsh` as a Pi subprocess or translating it into a Pi protocol.
3. Replacing either harness's native configuration, session, or credential
   model with a Pi-specific configuration model.
4. Claiming that a real health request is guaranteed to be free. Where the
   provider has no free availability endpoint, a health check may consume the
   smallest possible amount of inference and must say so clearly.
5. Making hard-killed processes, power loss, or operating-system failure appear
   synchronously recoverable. These cases require durable recovery on the next
   Piano start.

## 5. User experience

### 5.1 Human setup

The README tells the user to install and authenticate Claude Code and the
official DeepSeek Harness manually. It names the required executable and the
configuration prerequisites, but Piano does not download packages, invoke an
installer, create an account, or perform login on the user's behalf.

### 5.2 Doctor

The user can ask Piano to check one harness or both. Each result distinguishes
at least these outcomes:

- not installed or not executable;
- executable starts but configuration is incomplete;
- configuration is present but the real health request failed;
- real health request succeeded.

The successful result includes the harness identity, executable/version
evidence, selected model/provider identity where safe to display, and a clear
statement that a real request was made. Secrets are never printed.

The health request is a bounded, minimal real request made through the selected
harness. If a provider offers a genuine non-inference availability check, Piano
may use it; otherwise Piano performs one minimal inference request. Doctor
reports that this may incur provider cost unless the provider explicitly
guarantees otherwise.

### 5.3 Tuning mission configuration

Before a mission starts, Piano establishes an isolated configuration scope for
each participating harness:

1. Capture the complete user-owned configuration relevant to the mission.
2. Apply the Piano provider, model, and credential configuration.
3. Run the mission using the active Piano configuration.
4. Close the scope and restore the captured configuration exactly.

The user must be able to continue using Claude and `dsh` with the same settings
they had before Piano started. Piano's temporary values must not leak into future
shells, future harness launches, or unrelated user sessions.

Configuration ownership is explicit: Claude's native configuration remains
Claude-owned and `dsh`'s native configuration remains `dsh`-owned. Piano may
temporarily control the supported provider/model/credential fields, but it does
not silently rewrite unrelated user preferences.

### 5.4 Exit and recovery behavior

Configuration restoration is a mission lifecycle guarantee, not an optional
cleanup step. It applies when the mission:

- completes successfully;
- is left through `/exit`;
- is cancelled by the user;
- fails because of a harness, provider, workflow, or validation error;
- receives SIGINT or SIGTERM.

If the operating system terminates Piano before cleanup can run, Piano leaves a
durable recovery marker and restores the prior configuration before the next
Piano mission or reports an actionable recovery state. A mission cannot start
while an earlier temporary configuration is ambiguously owned.

## 6. Real usage acceptance task

The cross-harness acceptance task is run in a fresh temporary workspace, once
with Claude and once with `dsh`, using real credentials and a real provider:

> Use the write tool to create `proof.txt` with exactly `OK` followed by one
> newline. Use the read tool to verify it and reply exactly `OK`. Do not use
> shell commands.

The task is accepted only when all of the following are true:

1. The expected file exists with the exact expected bytes.
2. No unrelated workspace file was created or changed.
3. Piano observed the selected harness process and its real completion events.
4. The harness produced a non-empty final response reporting the result.
5. The run records enough transcript, usage, and artifact evidence to audit the
   result after the process exits.
6. The same task succeeds independently for Claude and `dsh`; a pass from one
   harness cannot stand in for the other.

Mocks, fake executables, canned stdout, intercepted API calls, and a process
that only prints `READY` are not valid evidence for this acceptance gate.

## 7. Functional requirements

### FR-1: Native harness identity

Piano treats Claude and `dsh` as separate harness products with separate
availability, invocation, configuration, transcript, and failure evidence.
No `dsh` behavior is implemented by routing to Pi.

### FR-2: Real doctor evidence

`doctor` must perform a real bounded health probe for a configured Claude or
`dsh` harness. An executable/version check alone is insufficient for a ready
result.

### FR-3: Mission configuration isolation

Piano can run a mission with a selected provider, model, and credential set
without permanently replacing the user's harness configuration.

### FR-4: Exact restoration

After mission scope closure, the relevant user configuration is byte-for-byte
equivalent to the captured pre-mission state, including the case where Piano
changes only part of a configuration document.

### FR-5: Effect-safe lifecycle

The configuration scope is tied to the mission resource lifecycle. Every
normal and handled failure path closes it exactly once; cleanup failures are
reported as mission failures and never silently ignored.

### FR-6: Honest test classification

The test suite labels mock/unit tests, subprocess integration tests, and real
LLM acceptance tests separately. A real-harness test is skipped unless its
explicit real-run gate is enabled, and a skipped test is never reported as a
pass.

### FR-7: Human-managed installation

Documentation describes the required manual installation and authentication
steps. Piano only detects what is already available and explains how to resolve
missing prerequisites.

## 8. Success criteria

This feature is complete when:

1. On a machine with Claude and `dsh` installed and configured, doctor reports
   both as ready only after successful real health requests.
2. On a machine missing either executable or credentials, doctor identifies the
   missing layer and exits with a non-success status for that check.
3. The real acceptance task passes independently for both harnesses and leaves
   auditable workspace and transcript evidence.
4. A tuning mission using temporary Piano configuration restores the user's
   prior Claude and `dsh` configuration after every supported exit path.
5. A subsequent direct Claude launch and direct `dsh` launch observe the user's
   original configuration, not Piano's temporary values.
6. The README clearly states the manual setup boundary and the possible cost of
   real health/inference checks.

## 9. Operational constraints

- Real calls require network access, valid credentials, and may incur provider
  charges.
- Health probes and acceptance prompts must be intentionally small and bounded.
- Tests must use an isolated workspace and must not overwrite the user's daily
  harness configuration.
- Secrets may be read for the request but must not appear in logs, reports,
  transcripts produced by Piano's diagnostics, or test output.
