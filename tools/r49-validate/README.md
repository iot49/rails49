# `@occupancy/r49-validate`

The corpus repo's validator, living here rather than there.

`iot49/r49` holds `.r49` archives; this checks them. It runs from a checkout of
`rails49` at `main` (issue #55), so nothing is published, no schema is vendored,
and `@occupancy/config` supplies `MIN_DPT` and the class vocabulary — meaning
`config.yaml` gains no second home for values that must agree.

It sits in `tools/`, not `lib/` and not `dataset/`, for two reasons: it is an
executable whose consumer is a foreign CI rather than a library `ui/` imports,
and `dataset/` drags `sharp` and `onnxruntime-node`. Validating a zip here costs
`jszip` + `zod` + `tsx` and no native builds.

## Use

```bash
# Print the capture-guidance table for CONTRIBUTING.md. Takes no paths, so it
# does not care what the working directory is. --silent is required, not
# cosmetic: without it pnpm writes its script banner to stdout, and #62 diffs
# that stdout against committed prose.
pnpm --silent --filter @occupancy/r49-validate guidance
```

Validation takes **paths**, and `pnpm --filter` runs a script with the working
directory set to the package — so a corpus workflow must not go through it, or
every relative path resolves against `tools/r49-validate/`. Run the CLI from the
corpus root instead, with the `rails49` checkout named explicitly:

```bash
# cwd is the corpus checkout; rails49/ is this repo, checked out beside it.
rails49/tools/r49-validate/node_modules/.bin/tsx \
  rails49/tools/r49-validate/src/cli.ts --author <handle> <path>...
```

Both forms exist because the two subcommands have genuinely different needs, not
as a convenience.

**stdout is machine, stderr is human — always both, no flag.** The workflow
pipes stdout through `jq` to build its `::warning` annotations and its job
summary; a person reads stderr. One code path serves both, so the rendering
nobody tests cannot drift from the one that matters.

| Exit | Meaning |
| :--- | :--- |
| `0` | No blocking errors. Warnings do not change this — that is what makes the bar soft. |
| `1` | At least one archive carries a blocking error. |
| `2` | The tool itself failed: bad arguments, an unreadable path, a bug. |

`1` and `2` are distinct on purpose. A crash here must never read as "your
archive is bad" to a contributor who did nothing wrong.

`--author` is the pull request author's handle, used only for the rule that a
submission sits under its own contributor directory. Omitting it skips that one
rule, so a contributor can run the tool locally without inventing a value.

## What it checks

Issue #57 decides the bar; `validate.ts` implements it and `corpus.ts` holds the
path rules from #56. Under `archives/<handle>/<slug>.r49` the blocking set is:
the archive loads as v4, the manifest and the zip name the same images in both
directions, no label is still `proposed`, every class is in the vocabulary, an
archive-level `id` is present, no two archives in one contributor directory
share an id, and the path is a slug under the author's own handle.

Warnings — DPT below `MIN_DPT`, calibration that does not resolve, images not
marked complete — are read by the maintainer and block nothing.

`fixtures/<slug>.r49` is held to structure only and gets **no warnings**: the six
are known to be zero-label and below `min_dpt` by design, so annotating that on
every pull request would be noise.

## The guidance table is generated, never typed

`layout.min_dpt` is provisional. A per-scale capture table hand-written into
another repository's `CONTRIBUTING.md` would be `min_dpt` living in two places
with nothing checking that they agree, so the corpus workflow diffs the
committed prose against `guidance`'s output. That is why the output has a fixed
column order and fixed rounding, and why it states its reference image width:
the width is an input to every number, not a constant.
