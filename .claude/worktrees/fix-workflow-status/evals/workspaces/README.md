# Develop eval workspaces

These archives are immutable Git snapshots shared by the generated cases in
the `develop` group. They contain the pre-fix implementation plus the complete
post-fix guard suite; dependencies and Git metadata are intentionally omitted.

| Archive | Source ref | Source commit | Expected focused failures | SHA-256 |
| --- | --- | --- | --- | --- |
| `aborted-subprocess-settlement.tar.gz` | `main` + pre-fix subprocess implementation | `637b1c8` | stdout pipe still open; stderr pipe still open | `d0ebb8b7f96e28940fc3dab677240439bc4b638fb6f2ce506a1407b4fac39547` |
| `footer-workflow-column-width.tar.gz` | `main` + pre-fix footer implementation | `637b1c8` | renderer width mismatch; right boundary clipped; DAG off-center | `433dcf961fefb24c343b7be3b8cfe8b047e65a7304c843672443b7732623375a` |

Regenerate a snapshot from the repository root with:

```bash
git archive --format=tar.gz --output=evals/workspaces/<case>.tar.gz evals/<case>
```