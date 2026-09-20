---
name: paper-finalize
description: Verify the compiled artifact against the venue's requirements and report, honestly, what the paper does and does not establish.
---

# Finalize

Inputs: the manuscript, and the injected handoff context — the `paper-brief`
result (venue, constraints, contributions), the `paper-calibration` result, and
the final round's `paper-revision` result.

Upstream results are not workspace files: each entry in the handoff record's
`inputs[]` carries the producer's `resultPayload` under its contract id and the
`resultPath` it was written to. Read them from there.

**Why only those three.** This stage sits outside the loop and depends on the
loop as a region, which resolves to the region's exit stage — `paper-revise`. So
the round's `paper-review`, `paper-audit` and `paper-figures` results do **not**
reach here, and this skill must not pretend otherwise. Everything they found is
supposed to arrive distilled in `revision.json`:

- `deferred[]` is the round's complete list of what could not be fixed, with
  what each item needed.
- `rejected[]` is what the reviewers got wrong and how the text now prevents the
  misreading.
- `incidental_changes[]` is what changed without being asked.

If a hole you can see in the manuscript has no entry in `revision.json`, say so
in `unresolved` as a reporting gap rather than silently repairing the record —
a final report that looks complete because the loop's exit stage was terse is
worse than one that admits it does not know.

## 1. Build the artifact

Clean build, not incremental: remove the intermediate directory, rebuild from
the venue's template, and report the exact command and its result. Rebuild twice
and confirm the byte-identical output if the pipeline regenerates anything — a
non-reproducible artifact is a defect the camera-ready deadline will find.

## 2. Mechanical verification

Each check is answered by inspecting the built artifact, never by assumption:

| Check | How |
|---|---|
| page_limit | Count the pages of the built PDF against `venue.page_limit`, including references and appendices as the venue counts them. Report the number and the requirement. |
| template | The class, the option set, and the page geometry match `venue.template`. |
| anonymized | If `venue.anonymized`, no author names, affiliations, acknowledgements, funding text, or self-identifying URLs. Search the sources as well as the PDF. |
| refs resolved | No undefined references or citations in the build log; the log is otherwise free of the errors that quietly break cross-references. |
| figures | Every figure resolved to a file, is legible at print size, and its caption states its claim rather than its title. |
| header material | Abstract within the venue's length, keywords present, CCS concepts or topic list filled in if the template requires them. |
| appendix | Reproducibility and artifact material the venue expects: configuration, evaluation protocol, and where the data lives. |
| tarball | The submission package contains what the venue asks for and nothing it forbids (no stray build products, no data the venue's size limit rejects). |

Record each as `passed`, `failed`, or `not_checked` **with the evidence you
observed**. `not_checked` is an honest answer; a silent pass is not.

## 3. The honest account

This section is the reason you exist. Collect, without softening:

- **Every deferred item** from the final revision, still open, with what it
  needed. `revision.json`'s `deferred[]` is authoritative here; carry its `needs`
  and `reason` through rather than restating them more vaguely.
- **Every claim the paper makes that rests on a narrowed statement** rather than
  a measurement. `revision.json`'s `resolved[]` entries say what changed: an
  entry that replaced a number with the value its source holds is a measurement,
  one that qualified a claim is a narrowing. Where an entry does not make the
  distinction clear, read the current text and decide, and say which you did.
- **What the evaluation does not cover.** Shapes, hardware, workloads, baselines
  the reviewers would expect and that are not there. The round's reviewers are
  not visible here, so judge this against the paper itself and against
  `brief.json`'s contributions — a contribution whose evaluation artifact does
  not exist is the clearest version of this.
- **What a human must decide before submitting** — anything you could not settle
  mechanically, stated as the decision rather than as a recommendation buried in
  prose.
- **What the paper is still missing, counted.** Take the brief's `placeholders[]`
  and the last audit's placeholder census. Every entry still `open` goes into
  `placeholders.open` with the source that would close it, `placeholders.filled`
  counts the rest, and `placeholders.blocking_ready` is `true` when any remain
  open. Search the manuscript for `\ph{` yourself rather than trusting the audit's
  list: an unregistered site is exactly the kind of thing that reaches a PDF.

  This is not a formality, it is a gate. A paper that ships with `\ph` sites has
  reserved slots where results should be and filled none of them, so it is not a
  submittable version of the paper even if every other check passes. The contract
  refuses `ready: true` while `blocking_ready` is true, which is the point: the
  honest output is a finished paper plus a short list of what its author still
  owes it, and a reader can then tell "not yet measured" from "measured and
  small". Do not drop a site from the list to make `ready` reachable, and do not
  fill one in — you have no measurement the author does not have.

Then `ready`: `true` only when no check failed, the artifact builds clean, and
the venue's hard requirements are met. A paper with a `not_checked` hard
requirement is not ready. A paper with an honest limitation is ready — the
limitation is what the limitations section is for. A paper with an open
placeholder is not ready, and that is not a contradiction of the previous
sentence: a limitation is something the paper measured and bounded, a placeholder
is something it never measured at all.

## 4. Artifact paths

List the files a human needs to upload or archive, with their paths and sizes,
so the submission is a copy rather than a scavenger hunt.

## 5. Self-check

- [ ] The build was clean, and the command and result are both reported.
- [ ] Every check has a status and the evidence it rested on.
- [ ] Every deferred item from the final revision appears in the report.
- [ ] Narrowed claims are distinguished from measured claims.
- [ ] Every `\ph{` site in the manuscript appears in `placeholders.open`.
- [ ] `ready` follows the stated rule, not the wish for it to be true.
- [ ] The report contains no claim you did not verify.
