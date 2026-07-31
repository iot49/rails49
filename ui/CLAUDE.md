# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in `ui/`.

A static, fully client-side webapp: [Lit](https://lit.dev/) elements, [Shoelace](https://shoelace.style/)
components, Vite, TypeScript. It edits `.r49` layout archives through the file picker and runs the
classifier in the browser via ONNX Runtime WASM. **There is no backend — do not introduce one
without discussion.**

## The three documents, and which one is true

| File | What it is | Trust it for |
| :--- | :--- | :--- |
| `../SPEC.md` | Requirements and rationale for the **whole project**, not just `ui/` — the **target**. Its § Format is now built (manifest v4, car spans, sensors, provenance); the v4 **editor** and the **detector** are not. | *why*, and what to build next |
| `README.md` | Per-component contracts: properties, events, hierarchy — describes only what is built | the shape of existing components |
| `src/` | What actually ships | ground truth |

**The editor has been reduced to what v4 supports and no further** (#19). It opens an archive,
manages its images, edits layout metadata, and reports DPT. Point-marker authoring and two-point
calibration dragging are gone, and `src/prototype/` with them. The target state was deliberately
"compiles, tests pass, does less" — **not** "authors v4".

So a missing affordance is usually a deferral, not a bug. Car authoring (chain-clicked spans,
shared coupler handles, the width rectangle), sensor placement, the calibration-point tool, the
state-dependent right-click and its context menu, and the completeness affordance are all specified
in `../SPEC.md` § Labeling Workflow and belong to the editor spec — a separate effort. Don't
reconstruct them piecemeal to close a gap you notice here.

Where README and the code disagree, the code wins and README is the thing to correct:
**a change to a component's properties or events belongs in README in the same commit.**

## Commands

```bash
pnpm --filter @occupancy/ui dev        # HTTPS dev server (dev:http for plain HTTP)
pnpm --filter @occupancy/ui test       # vitest, jsdom
pnpm --filter @occupancy/ui test:watch
pnpm --filter @occupancy/ui typecheck
pnpm build                             # vite build → ui/dist/
```

Dev serves HTTPS with a self-signed cert because `getUserMedia` needs a secure context (a phone on
the LAN must use the HTTPS URL), and sets COOP/COEP because ORT's threaded WASM requires cross-origin
isolation. Both are configured in `vite.config.ts`; don't drop them.

## Architecture

### State: props down, events up

`rr-app` owns the single `R49Archive` and the view mode. It passes `.archive` down as a property and
listens for bubbling `rr-*` events coming up. Every child event is
`new CustomEvent('rr-<verb>', { detail, bubbles: true, composed: true })` — `composed` is required to
escape the shadow root. Children never reach into the archive's parent or mutate global state.

Lit does not observe mutations *inside* `R49Archive`, so handlers that edit the manifest in place
call `this.requestUpdate()` (as `rr-app._onLayoutChange` does). Prefer replacing the object where
practical; call `requestUpdate()` where not.

### Every manifest mutation goes through `history.record`

`rr-app` owns one `EditHistory` (`src/history.ts`) and passes it down. **Any code that changes
`ManifestData` must run inside `history.record(label, target, mutate)`** — including the image
handlers in `rr-editor-view`, which mutate the archive without going through `rr-app` at all.

Nothing enforces this. A component that reaches into `.archive` directly still typechecks, still
renders, and leaves a stack that is *wrong* rather than merely short: undo then reverses the edit
before it, which is worse than having no undo, because the binding has taught the user to trust it.

Two rules follow from entries being scoped snapshots:

* **Declare the subtree you actually touch** (`layout`, one `image`, or the `images` array).
  Mis-declaring it is the only class of bug this design admits, and `tests/history.test.ts` fuzzes a
  round-trip specifically to catch it.
* **Key on label `id`, never on object identity.** Applying a snapshot replaces objects wholesale.

An edit that *removes* images must pass `options.retain` with their filenames — the bytes are gone
from the zip by the time the entry could look for them. Additions are captured automatically.

`SPEC.md` § Undo and redo carries the reasoning, including the parts the editor spec still has to
build: per-gesture drag commits and the chain interception that makes a live chain a wall Cmd+Z
cannot cross.

### `rr-viewer` is shared, and that is load-bearing

The same component backs the editor (`src` → `<img>`) and the live view (`stream` → `<video>`).
Both media elements use `object-fit: contain`, matched to the SVG's `preserveAspectRatio="xMidYMid meet"`,
so the viewBox maps 1:1 onto image pixel coordinates and a marker lands in the same place in both
modes. Changing either half of that pair silently misplaces every marker.

`symbolSize = MARKER_SIZE_PX * (resolution.width / svgRect.width)`, recomputed by a `ResizeObserver`,
keeps markers a constant *screen* size.

The viewer **reports pointer gestures and authors nothing**. It emits `rr-pointer-down`/`-move`/
`-up`/`-cancel`/`-contextmenu` with coordinates already converted to **image pixels**, so no consumer
ever handles screen coordinates and none can convert them wrongly. The conversion uses
`createSVGPoint` + inverse `getScreenCTM`; **never subtract `getBoundingClientRect()` by hand** — the
rect ignores the letterbox, so the hand-rolled version is right only while the viewport happens to
match the image's aspect ratio. The same matrix yields `imagePxPerScreenPx`, which is what turns a
grab radius in screen pixels into one in image pixels.

The v3 machinery that *mutated* — marker add/move/delete, the draggable `{p0, p1}` pair — went with
the v4 reduction and does not come back. Deciding what a gesture means is the editor's job; the
arithmetic it needs is in `geometry.ts`.

### `geometry.ts` holds the arithmetic, because a component cannot be tested

Car width from DPT, a span's oriented rectangle, and hit-testing live in a pure module. jsdom does
not lay out or paint, so anything left inside a Lit element is untestable until `@web/test-runner` is
stood up — which nothing has done. Put new editor geometry here, not in the component that happens to
need it first.

Three rules it encodes, each of which is wrong somewhere if reimplemented:

* **No scale lookup.** The ratio cancels out of `DPT × STANDARD_WIDTH / STANDARD_GAUGE`, so a car is
  2.09 track-widths wide in every scale. Both constants come from `@occupancy/config`.
* **Tolerances are screen pixels**, converted with the viewer's `imagePxPerScreenPx`. A grab radius
  belongs to the mouse, not to the photograph.
* **A coupler is exact coincidence.** Nothing about a coupling is stored; it is car ends at the
  identical pixel, which chaining and the shared handle guarantee. A proximity test would fuse cars
  the user placed separately.

### `marker.ts` is a module, not an element

Custom elements break the SVG namespace when nested in `<svg>`, so markers are three plain exports —
`renderMarker`, `markerDefs`, `markerStyles` — that **must be used together**: defs in the SVG,
styles in the host's `static styles`, renderer per marker. The module boundary is the encapsulation.

### Absolute `/ui/` paths

`base: '/ui/'` in `vite.config.ts`, and runtime asset paths are hardcoded to match:
`setBasePath('/ui/shoelace')` in `rr-app.ts`, `/ui/ort/`, `/ui/models/model_int8.ort`. Changing
`base` means changing all of them.

### Classifier loading lives only in the live view

`rr-live-view.ts` is now the sole place that constructs a `BrowserClassifier`. It branches on the
hostname: if it is `__RAILS_DOMAIN__` (injected at build time) or `*.pages.dev`, it points
`ort.env.wasm.wasmPaths` at the jsDelivr CDN, because `bin/deploy.sh` strips the 26 MB of `.wasm`
from the bundle; otherwise `/ui/ort/`. Then `load('/ui/models/model_int8.ort')`, whose filename must
agree with `ui/vite.config.ts` (see the root `CLAUDE.md`).

`rr-editor-view.ts` used to carry a byte-identical copy. It went with the v4 reduction (#19): the
only thing the editor did with a classifier was decorate point markers with a prediction, and v4 has
no point markers. **Do not reintroduce it there** — the duplication was a standing hazard, and
nothing in the reduced editor needs inference.

Vite copies the model into the bundle only if `classifier/resnet/models/` exists, so builds and
typechecks must keep working with no local model present.

### Shoelace

Import components one file at a time — `@shoelace-style/shoelace/dist/components/<name>/<name>.js` —
never the package barrel; the barrel pulls the whole library into the bundle. Type-only imports from
`@shoelace-style/shoelace` are fine. The dark theme is applied in `index.html`
(`<body class="sl-theme-dark">` + `dist/themes/dark.css`); components inherit `--sl-*` tokens, so use
those rather than hardcoding new colors.

## Coding standards

* Strongly typed TypeScript. Avoid `any`. The `as any` casts that exist (Shoelace `toast()`, blob
  construction, loosely typed manifest reads) are debt, not precedent — don't add more, and prefer a
  narrow local interface or a type guard over widening.
* Styles belong in the component's `static styles`. Inline `style=` attributes survive in
  `rr-live-view` and `rr-settings-dialog`; new code doesn't add to them. Shoelace
  part/custom-property overrides (`style="--width: 500px"`) are the accepted exception.
* Compose from small elements. All custom elements are `rr-<noun>[-<qualifier>]`; non-element modules
  use plain camelCase filenames (`marker.ts`, `capture.ts`). Add the `HTMLElementTagNameMap`
  declaration block at the bottom of every element file.
* Document each component with a short purpose comment and its interface (properties in, events out).
  Update `README.md`'s table for that component in the same change.
* Support current Chrome, Safari, and Firefox. Do not constrain features to accommodate other browsers.

## Testing

Vitest in **jsdom**, `@open-wc/testing` fixtures, `tests/<module>.test.ts` mirroring `src/<module>.ts`.
`tests/setup.ts` polyfills what jsdom lacks globally (`ResizeObserver`, `Element.animate`,
`matchMedia`, `URL.createObjectURL`). Two modules have no test file yet — `capture.ts` and
`rr-settings-dialog.ts`; touching either is a chance to add one.

What jsdom means in practice:

* **It does not lay out or paint.** `getBoundingClientRect()` is all zeros and SVG geometry
  (`createSVGPoint`, `getScreenCTM`) is absent, so `tests/rr-viewer.test.ts` stubs both per test —
  a scale plus an offset, standing in for a letterboxed viewport — and polyfills `PointerEvent` as a
  `MouseEvent` carrying a `pointerId`. This is why the arithmetic lives in `geometry.ts`: what the
  stub proves is that the viewer converts through the transform it is given, not that the transform
  is right. Assert DOM structure, attributes, computed values, and emitted events. Do not claim a
  test verifies visual appearance; it cannot.
* Camera (`getUserMedia`), ONNX sessions, and `PointerEvent` are mocked or polyfilled per test file.

Real in-browser coverage — visual regression and genuine pointer interaction — is a stated goal but
**is not wired up**. `@web/test-runner` sits in `devDependencies` with no config file and runs
nothing. Standing it up (or removing the dependency) is real work; until then, be accurate about what
the suite proves.

Run `pnpm test` from the repo root after changes here: it covers `lib/*` too, and `ui` consumes those
packages as TypeScript source, so a library change breaks the UI at typecheck rather than at publish.
