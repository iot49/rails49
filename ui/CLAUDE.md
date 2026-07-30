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

### `rr-viewer` is shared, and that is load-bearing

The same component backs the editor (`src` → `<img>`) and the live view (`stream` → `<video>`).
Both media elements use `object-fit: contain`, matched to the SVG's `preserveAspectRatio="xMidYMid meet"`,
so the viewBox maps 1:1 onto image pixel coordinates and a marker lands in the same place in both
modes. Changing either half of that pair silently misplaces every marker.

`symbolSize = MARKER_SIZE_PX * (resolution.width / svgRect.width)`, recomputed by a `ResizeObserver`,
keeps markers a constant *screen* size.

The viewer is **read-only** and has no pointer handling at all — `screenToSvg()` went with the v4
reduction. When the editor spec reintroduces clicking, convert pointer coordinates with
`createSVGPoint` + inverse `getScreenCTM`; never subtract `getBoundingClientRect()` by hand.

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
  (`createSVGPoint`, `getScreenCTM`) is absent. Nothing needs stubbing today because the viewer is
  read-only; editor-spec work that reintroduces pointer handling will need per-test stubs again.
  Assert DOM structure, attributes, computed values, and emitted events. Do not claim a test verifies
  visual appearance; it cannot.
* Camera (`getUserMedia`), ONNX sessions, and `PointerEvent` are mocked or polyfilled per test file.

Real in-browser coverage — visual regression and genuine pointer interaction — is a stated goal but
**is not wired up**. `@web/test-runner` sits in `devDependencies` with no config file and runs
nothing. Standing it up (or removing the dependency) is real work; until then, be accurate about what
the suite proves.

Run `pnpm test` from the repo root after changes here: it covers `lib/*` too, and `ui` consumes those
packages as TypeScript source, so a library change breaks the UI at typecheck rather than at publish.
