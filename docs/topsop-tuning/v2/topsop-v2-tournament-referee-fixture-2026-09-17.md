# Topsop V2 tournament referee fixture regression

Date: 2026-09-17

Evidence job: `1128031`

Implementation commit:
`67be5f6ccea2b3abd1b07db571c40bb69169eb7a`

## Failure

`tests/workflow/topsop-v2-tournament-dataflow.test.ts` expected the tournament
fan-in to contain one selected `tune.race.evaluate` result, but received all
three lane results.

## Root cause

The test runner writes each worker contract's canonical `example` as its fake
result. Commit `63582f0f001535998fdace3c8975c5b969da96ea` made the evaluate contract
more compact and removed its optional tournament `referee` from the example.
The schema and real worker instructions still supported and required referee in
tournament mode, but the fake evaluations no longer projected a metric. With no
metric, Piano correctly treated the race as no-winner and forwarded all three
results to promote.

This was a fixture regression, not a tournament selection runtime bug.

## Worker adjustment record

### `topsop-v2-evaluate`

**Reason**

The canonical measured example is reused by the tournament dataflow fixture and
should demonstrate the optional referee projection used by tournament mode.

**Changes**

- Restored a valid `referee` to the measured contract example.
- Kept referee optional in the schema so serial evaluate results remain valid.
- Compacted example-only JSON records to keep the worker contract below the
  existing 16 KB limit.

**Commit ID**

`67be5f6ccea2b3abd1b07db571c40bb69169eb7a`

## Test adjustment

The tournament dataflow test now normalizes any numeric workflow iteration count
to one round instead of assuming the source file contains exactly
`iterations: 5`. This keeps the fixture independent of a developer's temporary
smoke-test iteration count.

## Verification

- Tournament dataflow regression test passes.
- V2 contract, scenario, and knowledge tests pass.
- TypeScript typecheck passes.
