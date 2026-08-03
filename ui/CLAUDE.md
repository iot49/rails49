# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in `ui/`.

A static, fully client-side webapp: [Lit](https://lit.dev/) elements, [Shoelace](https://shoelace.style/)
components, Vite, TypeScript. It edits `.r49` layout archives through the file picker and runs the
classifier in the browser via ONNX Runtime WASM. **There is no backend — do not introduce one
without discussion.**

## The three documents, and which one is true

| File | What it is | Trust it for |
| :--- | :--- | :--- |
| `../SPEC.md` | Requirements and rationale for the **whole project** — the **target** | *why*, and what to build next |
| `README.md` | Per-component contracts: properties, events, hierarchy — describes only what is built | the shape of existing components |
| `src/` | What actually ships | ground truth |

The editor was reduced to what v4 supports (#19) — v3's point-marker authoring and `src/prototype/`
are gone for good — and rebuilt one ticket at a time: calibration points (place, drag, delete via
context menu), the tool palette and calibration gate, sensor authoring, car authoring, chaining,
reclassify, and the completeness affordance are all built. Every authoring surface v4 asks for
exists, but the editor is not finished — check GitHub Issues for what is open. **A missing
affordance is usually a deferral, not a bug.** One gap is deliberate and stated in the code: a
click **inside a car already labelled on this image** starts no car *while idle* — it would stack a
second box on the vehicle being aimed at — and it says so rather than doing nothing visibly (#43).
That is the whole width rectangle, `geometry.ts` § `carCovering`, generalising the older rule that a
click on a car *end* starts nothing — and the end handle now gives the **same reason**, because a
handle sits inside the same rectangle and two wordings would read as two rules. Under another tool a
car end stays silent: no car was being authored, so there is nothing to explain. A chain's second
click lands wherever it is aimed, existing end included; that is how a car is coupled onto a train
already drawn. Only the click that **starts** a
chain is checked: a drag may still take an endpoint into another car, and an archive that already
contains overlapping cars opens and edits unchanged — this gates authoring, and adds no validation
at the format layer.

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
before it, which is worse than having no undo. Rules, from entries being scoped snapshots:

* **Declare the subtree you actually touch** (`layout`, one `image`, or the `images` array).
  Mis-declaring it is the only class of bug this design admits; `tests/history.test.ts` fuzzes a
  round-trip specifically to catch it. Cars are per **image** and sensors are per **layout**, so a
  car edit targets `{ kind: 'image', filename }` and a sensor edit targets `layout` — a drag picks
  its target from what the press grabbed.
* **Key on label `id`, never on object identity.** Applying a snapshot replaces objects wholesale.
* An edit that **removes images** must pass `options.retain` with their filenames — the bytes are
  gone from the zip by the time the entry could look for them. Additions are captured automatically.
* **A drag uses `beginGesture`, not `record`**: a drag mutates on every pointer-move and must still
  be one Cmd+Z. Snapshot at pointer-down, mutate freely, `commit()` at pointer-up records one entry
  — or none, when the subtree came back byte-identical. One entry covering several objects falls
  out of the target being a subtree (a coupler drag's two cars share one image record). Undo and
  redo are **refused while a gesture is open** — the drag has already mutated outside the stack —
  so every ending path (a repeated `pointerId`, `disconnectedCallback`, `attach`) must close one.
* **A reveal is three steps in one order** (#37): `selectImage` on the *pending* entry's image,
  then the apply, then `syncFromArchive(filename, highlights)`. Undo may move the user; it may never
  change something they cannot see. The ordering keeps the snapshot from landing while the editor
  still points at the frame being left — it buys no intermediate paint, since Lit batches the two
  into one update, so **the highlight is what actually shows the user what moved**.
* **What an entry changed is diffed from its own snapshots**, never declared by the caller —
  `changedObjects` in `history.ts`. The editor holds those candidates as the history gave them and
  **resolves them on every render** — by `id` for a car or sensor, by pixel for a calibration point,
  which has no id. So an undone **add** lights nothing rather than throwing, and an edit arriving
  while the glow is up cannot leave it on a renumbered crosshair. The glow is `highlight.ts`,
  transient by a timer, and view state: it is written nowhere and survives no image change.
* The toolbar's tooltip is **qualified with the image** when the entry lands on another one
  ("Undo delete car — img_3.jpg"). `rr-editor-view` composes it, because `rr-app` owns the stack and
  the editor owns which image is on screen; neither knows both.

`SPEC.md` § Undo and redo carries the reasoning.

### Chaining (#33)

* Every click after the first is simultaneously the end of the current car and the start of the
  next: the same pixel is written as one car's `p1` and handed on as the next one's `p0`, so the
  coincidence a coupling is derived from is exact by construction — chaining records no train.
  **One history entry per car, never one for the train**: a mis-click on the last coupler of a
  twelve-car consist must cost one car.
* A chain is **view state**. Its anchor writes nothing, so every way of abandoning one (right-click,
  tool change, image change, a lost DPT, a new archive) costs the manifest and the undo stack
  nothing; the cars already written stay, each on its own entry.
* The `EditorMode` union is where state-dependent gestures dispatch: `idle` opens the context menu,
  `placing-car` ends the chain.
* The **rubber band** (`rr-viewer`'s `pendingCar`) draws the whole car it would commit, rectangle
  included — the rectangle is the only feedback that a label covers the car. The cursor is tracked
  **only** while a chain is live. On touch there is no cursor between taps, so the band is just the
  anchor's handle — a platform limit, not a gap to close, but worth knowing since the labeling
  device is a phone.
* **Undo is intercepted** through `rr-editor-view.interceptUndo()`, which `rr-app` awaits before
  touching the stack (`rr-app` owns undo and cannot see chain state). A live chain consumes
  **every** undo: further along it undoes the last car and walks the anchor back — but only if
  that undo actually removed the chain's car — and at the chain's start it clears the anchor and
  touches no history. Known cosmetic lag: the toolbar's undo label reads the stack's `undoLabel`
  and does not know about this wall; fixing it means feeding chain state to `rr-toolbar`, which no
  ticket asks for.
* A **coupling renders as one shared handle**, derived by `rr-viewer` from exact coincidence
  (`geometry.ts` § `couplerPoints` — the same rule the hit-test grabs by); the cars leave their own
  handles off at those ends. Dragging it is one entry moving every end under it.
* A second click on the **anchor's own pixel** writes no car — a zero-length span has neither an
  axis nor two ends — and the chain stays where it was.

### The vocabulary (#35)

`vocabulary.ts` reads `detector.vocabulary` out of `config.yaml` through the generated
`@occupancy/config` and is the **only place in `ui/` a class name comes from** — including the class
a new car is created as, which is the taxonomy's root rather than a literal `'stock'`. A hardcoded
class anywhere in `ui/` breaks the config→menu path while still typechecking. Rules, each stated in
`SPEC.md` § Parameters live in `config.yaml`:

* **The root is required in the stored class and never rendered.** An unrooted class is a
  segment-prefix of no `detector.classes` entry and is dropped from the export — the
  unlabeled-car-as-background failure the completeness rule exists to prevent. So the menu offers
  the root's *children*, and every row carries the full dotted class.
* **A nested object is a subtype; anything else (`width_mm`) is a property.** The distinction is
  structural, which is what avoids a reserved list of key names.
* **Conformance is a warning here, never a parse error.** A car whose class names no vocabulary
  entry draws in red with the class beside it, and the archive opens exactly as before — a format
  that refused files over a pruned `config.yaml` would punish config edits. The exporter is where
  the same mismatch becomes fatal.
* A **submenu row is opened, never chosen** (Shoelace does not select a parent), so a subtype with
  subtypes of its own repeats itself as the first row of its own submenu ("loco (unspecified)") —
  "kind unknown from the photograph" is a real answer and must stay reachable.

### Completeness (#36)

`labeled_complete` is the only place in the format where a human asserts something about **absence**
— no car in this image is unlabeled — and it is the one gate on detector training.

* `rr-editor-view._onCompleteToggle` is the **only** place `true` is ever written, one history entry
  per toggle. Nothing computed may stand in for it: an image whose labels are all `proposed` is
  byte-identical whether the user checked every one or clicked accept-all blind, so an accept-all
  must never set it.
* **Deleting a car clears the flag, in the same entry** (`SPEC.md` § Labeling completeness). Nothing
  can tell a label deleted off background from one deleted off a car still in the photograph, and a
  flag surviving the second case exports an image teaching the detector that cars are background.
  Setting is the claim only a human may make; clearing withdraws it and asks again. Deletion alone
  clears — adds, drags, and reclassify do not.
* The thumbnail-bar badge is a **readout, not a second control**: a toggle on a 64px thumbnail would
  let a click aimed at selecting an image assert completeness by landing a few pixels off.
* An image marked complete with **zero** cars is a valid all-background sample and warns about
  nothing.

### The calibration gate

* `rr-tool-palette` chooses the tool a click means and **disables the labeling tools while DPT is
  unresolved, stating why** — naming DPT, not the width rectangle: car width is derived from DPT
  rather than stored, so an uncalibrated archive cannot draw the rectangle that is the only
  feedback a label covers the car.
* The gate is on **existence, never completion** (`SPEC.md` § Labeling Workflow): `getDPT` returning
  a number *is* the gate. It is enforced twice on purpose — the palette disables the buttons, and
  `rr-editor-view.willUpdate` demotes a live tool back to calibration — because DPT can vanish
  through an **undo**, which `rr-app` applies straight into the archive with no editor handler
  seeing it.
* The **sensor** tool is gated with the car tool, one step beyond `SPEC.md` § Labeling Workflow — a
  sensor point needs no DPT to draw, but #31 asked for both. `needsDpt` is per tool in
  `rr-tool-palette.ts` if that is revisited.
* Sensors are **per layout**, carry **no provenance** (no model can propose where a human wants an
  answer), and their snowflake ids live in a namespace never compared with label ids. A sensor is
  placed unnamed: `name` is optional passthrough, never auto-generated, and the UI shows the `id`
  in its place.

### `rr-viewer` is shared, and that is load-bearing

The same component backs the editor (`src` → `<img>`) and the live view (`stream` → `<video>`).

* **The media and the overlay resolve to one box, by construction** (#41). Both cover the container
  and fit their content by the same rule — `object-fit: contain` against
  `preserveAspectRatio="xMidYMid meet"` — over a viewBox that is the **media's own pixel grid**.
  Two boxes fitted independently coincide only by luck; that drift is what let a sensor slide off
  its track as the window was resized.
* The authored frame (`camera.resolution`) reaches that grid through the `g.frame` scale
  (`geometry.ts` § `overlayFit`): everything drawn and every coordinate emitted is in the frame the
  manifest is written in (`SPEC.md` § Output encoding), **not** the image's own pixels. When an
  image is a different shape than the declared resolution, no mapping is correct (nothing records
  the crop); the defined answer is that the frame is **stretched** to cover the photograph, and the
  viewer emits `rr-media-frame` so the editor can warn (`.frame-warning`, which blocks nothing).
  Silently absorbing the mismatch is forbidden (#41).
* The viewer **reports pointer gestures and authors nothing**. It emits `rr-pointer-down`/`-move`/
  `-up`/`-cancel`/`-contextmenu` with coordinates already converted to **image pixels**, via
  `createSVGPoint` + the inverse of the **content group's** `getScreenCTM` (the group's user space
  is the authored frame) — **never a hand-rolled subtraction of `getBoundingClientRect()`**, which
  ignores the letterbox and is right only when the viewport matches the image's aspect ratio. The
  same matrix yields `imagePxPerScreenPx`, which converts grab radii and measures `symbolSize`.
  Deciding what a gesture means is the editor's job; the arithmetic is in `geometry.ts`. The v3
  machinery that mutated does not come back.
* `symbolSize = SYMBOL_SIZE_SCREEN_PX / ctm.a`, recomputed by a `ResizeObserver` off the **content
  group's** CTM (a ratio from the SVG's bounding rect is wrong by the letterbox), keeps annotations
  a constant screen size.
* It draws what it is given — `markers`, `cars`, `calibrationPoints`, `sensors` — from the manifest,
  never writing it. Cars draw **first**: their rectangles are the overlay's only area fills, and a
  point or sensor on a car must not be tinted over.

### `geometry.ts` holds the arithmetic, because a component cannot be tested

jsdom does not lay out or paint, so anything left inside a Lit element is untestable until
`@web/test-runner` is stood up — which nothing has done. Put new editor geometry here, not in the
component that happens to need it first. Rules it encodes, each wrong somewhere if reimplemented:

* **No scale lookup.** The ratio cancels out of `DPT × STANDARD_WIDTH / STANDARD_GAUGE`, so a car is
  2.09 track-widths wide in every scale. Both constants come from `@occupancy/config`.
* **Objects draw at world sizes; annotations at screen sizes.** A sensor is one track width across
  (`trackWidthPx` *is* DPT: px/mm × gauge_mm) and a car is 2.09, so both shrink with the
  photograph; labels, crosshairs, markers and endpoint handles stay constant on screen. `rr-viewer`
  holds both: `dpt` for world sizes, `symbolSize` for screen ones.
* **Tolerances are screen pixels**, converted with `imagePxPerScreenPx` — a grab radius belongs to
  the mouse, not the photograph — but a radius is a **floor, not a cap**: a world-sized symbol is
  grabbable across its whole footprint. `sensorDiameterPx` is shared by renderer and hit-test so
  the two cannot drift.
* **A coupler is exact coincidence.** Nothing about a coupling is stored; a proximity test would
  fuse cars placed separately. `hitTest` and `couplerPoints` apply the one rule, so what draws as a
  coupling is exactly what grabs as one.
* **`hitTest` is what a gesture can grab; `carCovering` is whether a pixel is already labelled.**
  Two questions, deliberately not one — a car's body grabs nothing, and only the car tool's first
  click asks the second one (#43). Both read the same `HitScene`, so the two can never disagree
  about what is on screen. It measures in the span's own frame, so a diagonal car is tested
  across its axis rather than across a bounding box half again too big, and the boundary counts as
  inside.
* One `DEFAULT_GRAB_RADIUS_SCREEN_PX` for every tool — it describes the pointing device, not the
  object. `CLICK_SLOP_SCREEN_PX` is smaller (hand tremor, not aim), and `isClick` keeps a swipe on
  a phone from placing a point.
* `dragHandles` turns a hit into the **list** of points a gesture moves — the coupler case, and why
  one entry can cover several objects. `dragTo` applies the same delta to each handle's
  *pointer-down* position: measured from the press so the grab offset survives, identical across
  handles so coupled ends stay on one pixel.

### Right-click is a state branch, and the menu knows nothing

* `rr-editor-view` dispatches `rr-pointer-contextmenu` through the `EditorMode` switch: context menu
  when idle, end-the-chain while chaining (`SPEC.md` § Right-click is state-dependent). Undo is
  state-dependent against the same states, through `interceptUndo()`.
* The native menu is suppressed **in the editor, not in `rr-viewer`**, and for every right-click —
  inside the labeling surface the gesture is the editor's whatever it lands on. `rr-live-view`
  shares the viewer, does not listen, and keeps the browser's menu.
* `rr-context-menu` renders rows and reports which was chosen; it never learns what the object is.
  The editor hit-tests and names subject *and* rows together in one `menuFor` switch — an object it
  cannot name a verb for opens no menu at all.
* A **coupler** is the one subject that is two objects — chaining makes couplings the normal case,
  and the middle car of a train has no free end — so it gets one delete row per car meeting there,
  each named by that car's direction (`geometry.ts` § `cardinalDirection`; coupled cars run
  opposite ways, so rows can never read the same). **Reclassify follows the same rule.** Every row
  acting on a car carries its id (`delete-car:<id>`, `reclassify:<id>:<class>`); a row that only
  opens a submenu uses a separate prefix (`reclassify-group:…`) — an id identifies a row, and two
  rows sharing one defeats that.
* Delete is **one entry scoped to what it deletes**: `layout` for a point or sensor, that image's
  record for a car. A calibration-point subject carries the pixel it was opened on
  (`_pointIsStillAt`, the same staleness guard the calibration dialog uses) — an undo landing while
  either is up can slide an index onto another point. Cars and sensors carry an `id` and need no
  guard.
* Right-click shares the pointer stream with the left button: the editor **ignores presses and
  releases whose `button` is not primary** (otherwise the press that opens the menu also runs the
  click path, and a secondary release ends a left drag mid-gesture), and the menu **swallows its
  own dismissing press** (so closing a menu over empty image places no point).

### Markers are modules, not elements

Custom elements break the SVG namespace when nested in `<svg>`, so `marker.ts`,
`calibrationMarker.ts`, `sensorMarker.ts` and `carMarker.ts` are plain-export modules whose exports
(renderer, defs where needed, styles) **must be used together** — the module boundary is the
encapsulation. Each object type is unmistakable in both shape and colour, a requirement rather than
taste (`SPEC.md` § Reference points: authored by different tools, meaning different things); README
carries the exact exports and glyphs. Two rules that don't show in the README table:

* `renderCar` takes the **DPT**, not a width — the 2.09 derivation lives in `geometry.ts`, and a
  caller passing a number would be a second place to get it wrong. A `null` DPT draws the chord and
  handles with **no rectangle**: there is no derived width to claim, and authored cars must stay
  visible after a calibration point is deleted.
* Labels flip inwards at a frame edge through the shared `placeLabel`.
* `highlight.ts` spans all three: one white glow, on the group, for whichever object a reveal
  points at. Its class and its styles are used together like every other pair here. White because
  each type's own ink is a requirement, so a coloured highlight would read as a fourth kind of
  object.

### Absolute `/ui/` paths

`base: '/ui/'` in `vite.config.ts`, and runtime asset paths are hardcoded to match:
`setBasePath('/ui/shoelace')` in `rr-app.ts`, `/ui/ort/`, `/ui/models/model_int8.ort`. Changing
`base` means changing all of them.

### Classifier loading lives only in the live view

`rr-live-view.ts` is the sole place that constructs a `BrowserClassifier`. It branches on the
hostname: `__RAILS_DOMAIN__` (injected at build time) or `*.pages.dev` points
`ort.env.wasm.wasmPaths` at the jsDelivr CDN, because `bin/deploy.sh` strips the 26 MB of `.wasm`
from the bundle; otherwise `/ui/ort/`. Then `load('/ui/models/model_int8.ort')`, whose filename must
agree with `ui/vite.config.ts` (see the root `CLAUDE.md`).

`rr-editor-view.ts` used to carry a byte-identical copy; it went with the v4 reduction (#19).
**Do not reintroduce it there** — the duplication was a standing hazard, and nothing in the reduced
editor needs inference.

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
`matchMedia`, `URL.createObjectURL`). `capture.ts` and `rr-settings-dialog.ts` have no test file
yet; touching either is a chance to add one.

* **jsdom does not lay out or paint.** `getBoundingClientRect()` is all zeros and SVG geometry
  (`createSVGPoint`, `getScreenCTM`) is absent, so `tests/rr-viewer.test.ts` stubs both per test —
  a scale plus an offset, standing in for a letterboxed viewport — and polyfills `PointerEvent` as
  a `MouseEvent` carrying a `pointerId`. The stub proves the viewer converts through the transform
  it is given, not that the transform is right — which is why the arithmetic lives in
  `geometry.ts`. Assert DOM structure, attributes, computed values, and emitted events; never claim
  a test verifies visual appearance.
* Camera (`getUserMedia`) and ONNX sessions are mocked per test file.
* The drag tests dispatch `rr-pointer-*` events shaped the way `rr-viewer` emits them, so they
  cover the editor's half of a gesture — one entry, no-op suppression, the sticky drag flag — and
  **not** pointer capture, which is the browser's and the viewer's. A drag leaving the viewer is
  exercised as coordinates outside the image, which is what the editor actually sees.
* Real in-browser coverage — visual regression, genuine pointer interaction — is a stated goal but
  **is not wired up**: `@web/test-runner` sits in `devDependencies` with no config file and runs
  nothing. Standing it up (or removing the dependency) is real work; until then, be accurate about
  what the suite proves.

Run `pnpm test` from the repo root after changes here: it covers `lib/*` too, and `ui` consumes
those packages as TypeScript source, so a library change breaks the UI at typecheck rather than at
publish.
