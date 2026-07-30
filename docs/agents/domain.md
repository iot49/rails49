# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo keeps its domain documentation in **one place: `SPEC.md` at the root**, covering the whole pipeline (`dataset` → `classifier` → `lib/*` → `ui`). It carries the vocabulary, the requirements, and the reasoning behind each decision.

**There is no `CONTEXT.md` and no `docs/adr/`, deliberately.** That split was considered and rejected while assembling the spec ([issue #9](https://github.com/iot49/rails49/issues/9)): decision rationale already lives on **GitHub issues** — wayfinder maps and their tickets — in more detail than an ADR would carry, and a separate glossary would duplicate vocabulary `SPEC.md` already defines. Three surfaces to keep in sync is worse than one. Don't create either without discussing it first.

## Before exploring, read these

- **`SPEC.md`** at the repo root — the requirements and the *why*.
- **The wayfinder map(s)** on GitHub Issues, labelled `wayfinder:map`, plus the closed tickets they index. This is the decision record. `SPEC.md` links to the relevant ticket at each decision, so follow the link when you need the full reasoning rather than the conclusion.

**`SPEC.md` describes the target, not what ships.** Much of it is unbuilt — the shipped code is manifest v3 with point markers and no detector. Where the spec and the code disagree, that gap is the planned migration, not a bug to fix. `CLAUDE.md` and `ui/README.md` describe what exists today.

## File structure

```
/
├── SPEC.md              ← requirements + rationale, whole project
├── CLAUDE.md            ← what exists, and how to build it
├── docs/
│   ├── agents/          ← these files
│   └── research/        ← research notes cited by SPEC.md
├── lib/
├── ui/
├── dataset/
└── classifier/
```

Some research notes cited by `SPEC.md` live on their own branches rather than on `main` (`research/label-derivation`, `prototype/yolo-bench`). The citation names the branch where that is the case.

## Use the spec's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as `SPEC.md` defines it. Don't drift to synonyms it explicitly avoids — the terms have moved before and the spec records the current one:

- **sensor** for a query point where occupancy must be reported — not *detector* (which now means the model) and not *block* (rejected, because a block is prototypically an interval and sensors are points).
- **car** for the labeled object; `stock` is its class *string* in the taxonomy, not the word for the thing.
- **L0** and **L1** for the two occupancy layers — raw detections, and per-sensor state derived from them.
- **track** is a deferred concept, not a stored one: v4 holds no track geometry at all.

If the concept you need isn't in the spec yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (raise it).

## Flag conflicts with settled decisions

If your output contradicts `SPEC.md` or a closed wayfinder ticket, surface it explicitly rather than silently overriding:

> _Contradicts SPEC.md § Track is not stored (settled in #13) — but worth reopening because…_

Prefer citing the ticket over the spec section where both apply: the ticket holds the reasoning and the alternatives that were rejected, which is what makes a decision worth reopening or not.
