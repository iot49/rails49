# Occupancy Dataset Preparation

This directory held the tools for extracting training data from `.r49` railroad
layout archives. **Both are currently parked and neither runs.**

## Scripts

### `pnpm run prep` — ⚠️ PARKED (exits non-zero)

It scanned a local `r49/` directory for archives and cut one 144×144 crop per point marker, tagged
by the marker's type, split deterministically 80/20 by a hash of archive, image
and marker id.

v4 stores no point markers. A label is a **car** — a two-point span along the
car's centerline — and a **sensor** is a per-layout query point, not a tagged
sample. Deriving crops from car spans alone puts every crop centre on a car, so
every crop earns the same tag: the vocabulary does not shrink from three tags to
two, it collapses to **one, degenerate, with no negatives at all**. That is why
`classifier.labels` was deleted from `config.yaml` rather than corrected.

**The route back** is sampling background crops as *verified* negatives.
`labeled_complete` asserts that no car in an image is unlabeled, which makes any
crop centre intersecting no span a verified negative rather than a presumed one.
That changes the negative distribution and so invalidates any gate built on the
old one — it is an experiment to run, not a schema question to answer, and it
stays dormant while the ResNet does.

**Do not revive this by inventing a substitute vocabulary or synthesising
negatives.** See `SPEC.md` § v4 cannot produce a trainable CNN dataset
(issues #8, #18).

### `pnpm run online-diagnostics` — ⚠️ PARKED (exits non-zero)

It re-classified every marker with the exported model and printed a confusion
matrix. Same cause: no markers, no per-marker ground-truth tag.

It also measured nothing generalizable, having scored the same archives the
model trained on. A replacement belongs to the held-out accuracy protocol that
does not yet exist (`SPEC.md` § Accuracy).

## Directory Structure

There are no `.r49` archives here any more (#63). The corpus is
[`iot49/r49`](https://github.com/iot49/r49), which takes submissions by pull
request under CC BY 4.0. The six this directory used to hold are in that repo's
`fixtures/` tree — **fixtures, not training data**, sitting below
`layout.min_dpt`, so no number derived from them predicts model accuracy. How
training code reaches the corpus is not decided; see issue #51.

*   `data/`: The generated training database (gitignored; nothing generates it
    today).
*   `src/data_prep.ts`, `src/online_diagnostics.ts`: parked stubs carrying the
    reasoning above.
