---
name: triton-profile
description: Produce fresh bounded profile evidence for the promoted Triton kernel.
---

# Triton profile

Read the current-best state and run the workspace's `profile.py`. Use only its
real timing and derived evidence; do not claim counters that were not collected
and do not profile an unpromoted candidate. Return the requested
`profile-report` and preserve the harness-generated report artifact.
