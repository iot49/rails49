# `format-v4.r49` — written once, never regenerated

**If a change makes this file fail to load, that change breaks v4 and needs a
version bump — not a new fixture.**

That is the whole contract, and it only holds while the bytes stay frozen.
Regenerating on every format change would make the fixture always match current
code, which is exactly the blindness it exists to cure: `archive.test.ts` writes
with the same code it reads with, so `write(x); read() === x` passes even when
writer and parser drift **together**. A file written once, a year ago, is the
only thing that catches "a v4 archive no longer loads".

So there is no generator here. One existed for the length of a single commit
(#67) and was deleted with it, because a committed generator is an invitation to
re-run it — and re-running it is the failure.

## What is in it

Built by `R49Archive.export()`, so it is a genuine sample of what this project
emits rather than a hand-typed specimen:

* one 1×1 JPEG, `frame.jpg`
* four calibration points — three at `z: 0` and one above, which never enters the
  fit. The third is deliberately 10 px off a perfect fit, so `getDPTResidual`
  reports a real number instead of the structural zero a single pair gives.
* two car labels, covering both non-trivial arms of the `provenance`
  discriminated union: `human` (where `proposed_by` is forbidden) and
  `corrected` (where it is required). That union is the most fragile part of the
  schema.
* one sensor, with a name
* an archive-level `id`, minted at generation time

Its numbers are asserted in `../format-fixture.test.ts`.
