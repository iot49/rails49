# UI

Web app for configuring track occupancy detection, plus a live view for real-time observation.

Everything runs client-side: `.r49` archives are opened and saved through the file picker, and
classification runs in the browser via ONNX Runtime. There is no backend.

* **`../SPEC.md`** — what the system is *for*, and the requirements it is working toward. Covers the
  whole project, not just this package. Much of it is not built yet; treat it as the target, not a
  description.
* **`CLAUDE.md`** — build, test, and deploy mechanics, and the invariants an edit can break.
* **This file** — the component reference: what exists today, and each component's interface.

## Naming conventions

### Custom element prefix: `rr-`

All custom elements use the `rr-` prefix (**r**ail**r**oad).

- The HTML spec requires a hyphen in custom element names, to distinguish them from future standard
  elements.
- `rr-` does not collide with common library prefixes (`sl-` for Shoelace, `md-` for Material).
- Registrations are `rr-<noun>` or `rr-<noun>-<qualifier>`: `rr-app`, `rr-viewer`, `rr-editor-view`.

### File naming

| Kind | Convention | Example |
|---|---|---|
| Lit custom element | `rr-<name>.ts` | `rr-viewer.ts` |
| SVG template module | `<name>.ts` | `marker.ts` |
| Utility / service | `<name>.ts` | `capture.ts` |
| Test file | `<name>.test.ts` in `tests/` | `tests/marker.test.ts` |

Non-element modules use plain camelCase filenames with no prefix.

---

## Component hierarchy

```
rr-app                          ← shell: owns the archive and the view mode
├── rr-header                   ← app bar: status slot, view toggle, settings gear
│   └── rr-settings-dialog      ← layout metadata (sl-dialog)
├── rr-editor-view              ← editor mode; images, DPT readout, calibration points, sensors, cars
│   ├── rr-toolbar              ← vertical icon bar (file ops + undo/redo)
│   ├── rr-tool-palette         ← active tool, and the calibration gate on the labeling ones
│   ├── rr-viewer               ← SHARED: media + SVG overlay; reports pointer gestures
│   │   ├── marker.ts           ← module, not an element
│   │   ├── calibrationMarker.ts ← module: the labelled crosshair
│   │   ├── sensorMarker.ts     ← module: the labelled diamond
│   │   └── carMarker.ts        ← module: the chord and its width rectangle
│   ├── rr-thumbnail-bar        ← horizontal image selector strip
│   ├── rr-calibration-dialog   ← asks for a point's x/y/z in mm (sl-dialog)
│   ├── rr-sensor-dialog        ← asks for a sensor's optional name (sl-dialog)
│   └── rr-context-menu         ← right-click verbs on one object (sl-menu)
└── rr-live-view                ← live mode; owns the classifier
    ├── rr-stats-bar            ← FPS / marker-count overlay
    └── rr-viewer               ← SAME component, video source instead of img
        └── marker.ts
```

> **The editor authors calibration points, sensors and cars.** v3's point-marker
> placement and two-point calibration dragging were removed in the v4 reduction
> ([#19]); v4 stores neither. [#27] added the provisioning — `rr-viewer`
> reporting pointer gestures in image pixels, and `geometry.ts` holding the
> car-width, rectangle and hit-testing arithmetic — and [#28] gave it its first
> consumer: click a pixel, type its world coordinate, and the point is written as
> one `layout` history entry. [#30] added the drag — the same point moves, and
> the whole gesture costs exactly one entry. [#29] added the right-click: a
> context menu on the object under the cursor, carrying delete, which is why the
> editor needs no delete mode. [#31] added the **tool palette** and the
> **calibration gate** — while DPT is `null` the labeling tools are disabled and
> the reason is stated — and **sensor authoring** on top of the same shared
> paths: click to place, click or the menu to name, drag to move, menu to delete.
> [#32] added **car authoring**: two clicks on the visible ends write one span
> per image, drawn as a chord inside the translucent width rectangle that DPT
> derives — which is what the gate exists for. [#33] made those clicks a
> **chain**: every click after the first ends one car and starts the next, a
> rubber band shows the chain in flight, right-click ends it, a coupling renders
> as one shared handle that drags both cars, and undo is intercepted by the
> chain it would otherwise reach past.
>
> Still absent, each with its own ticket: reclassify ([#35]) and the completeness
> affordance ([#36]), both specified in `../SPEC.md` § Labeling Workflow.
>
> [#19]: https://github.com/iot49/rails49/issues/19
> [#27]: https://github.com/iot49/rails49/issues/27
> [#28]: https://github.com/iot49/rails49/issues/28
> [#29]: https://github.com/iot49/rails49/issues/29
> [#30]: https://github.com/iot49/rails49/issues/30
> [#31]: https://github.com/iot49/rails49/issues/31
> [#32]: https://github.com/iot49/rails49/issues/32
> [#33]: https://github.com/iot49/rails49/issues/33
> [#35]: https://github.com/iot49/rails49/issues/35
> [#36]: https://github.com/iot49/rails49/issues/36

## State and data flow

There is no Lit context and no shared store. `rr-app` holds the single `R49Archive` and passes it
down as the `.archive` property; children report upward with bubbling `rr-*` custom events:

```
        .archive ↓                    ↑ rr-* events (bubbles: true, composed: true)
rr-app ─────────── rr-editor-view ─────────── rr-viewer / rr-toolbar / rr-thumbnail-bar
   │
   └─────────────── rr-live-view ───────────── rr-viewer / rr-stats-bar
```

* **`rr-app` owns:** the archive, the **undo history**, the view mode, the status string, and file
  new/open/save.
* **`rr-editor-view` owns:** the current image index, blob URLs for the images, **the active tool**,
  the **chain in progress** (`EditorMode`, plus the cursor the rubber band follows), the click that
  is waiting on a coordinate or a name, and what the context menu is open on. It mutates the archive
  through image add/remove/reorder, through calibration-point placement, edits and deletion, sensor
  placement, naming, drag and deletion, and through car placement, drag and deletion — each wrapped
  in `history.record` (or in one `beginGesture` per drag). A chain in progress is **view state**: an
  anchor writes nothing until the click that closes a car on it, so abandoning one leaves both the
  manifest and the stack untouched — however many cars the chain already wrote, since each of those
  is its own committed entry.
* **`rr-live-view` owns:** the camera stream, the classifier, and the classification loop. It never
  mutates the archive.
* **Only the live view loads a classifier.** The editor's use of it was displaying a per-marker
  prediction, and there are no markers to predict for.

Lit does not observe mutations *inside* `R49Archive`, so handlers that edit the manifest in place
call `this.requestUpdate()` explicitly.

**Every manifest mutation goes through `history.record`** (see `history.ts`), so an edit made by
reaching into `.archive` directly leaves an undo stack that is wrong rather than short. Children
report a recorded edit upward with `rr-history-change`, which is what re-renders the toolbar's
enabled state.

---

## Component reference

### `rr-app`

Application shell. Owns the archive and routes between the two views.

**Internal state** (no public properties): `_archive`, `_history`, `_viewMode` (`'editor' | 'live'`),
`_status`. Starts with no archive loaded.

**Handles:** `rr-view-toggle`, `rr-layout-change`, `rr-file-new`, `rr-file-open`, `rr-file-save`,
`rr-undo`, `rr-redo`, `rr-history-change`.

**Keyboard:** Cmd/Ctrl+Z and Cmd+Shift+Z / Ctrl+Y, bound on `window`, **editor view only**. The
handler bails when a field has focus, testing `event.composedPath()[0]` rather than `event.target` —
Shoelace inputs are custom elements, so `target` is retargeted to the host and the naive check would
hijack Cmd+Z mid-typing. A press with a drag still live returns nothing (see `history.ts`), and
`_undo`/`_redo` already do nothing when the stack hands back no entry.

* `rr-file-new` and `rr-file-open` **confirm before discarding unsaved changes** (`_history.isDirty`),
  since replacing the archive takes the undo stack with it. This is the one destructive act undo
  cannot cover.
* `rr-file-save` marks the history position saved rather than clearing it — undoing past a save is
  legitimate, because the bytes on disk are unaffected.
* Undo and redo reveal what they changed: an entry scoped to another image calls
  `rr-editor-view.syncFromArchive(filename)`, which selects that image before the change lands.
* **Undo is offered to the editor first** ([#33]): `_undo` awaits `rr-editor-view.interceptUndo()`
  and stops there when it returns true. A live chain is a wall undo cannot cross, and only the editor
  knows one is live — so the protocol is one question asked here rather than chain state pushed up.
  Redo is not offered: only undo is state-dependent (`../SPEC.md` § Undo and redo).

* `rr-file-new` builds an empty **v4** manifest — layout `'New Layout'`, scale `N`, resolution
  1920×1080, empty calibration points and no sensors.
* `rr-file-open` reads a `.r49` through a file input and `R49Archive.load()`.
* `rr-file-save` `export()`s and downloads. **It does not validate calibration.** The v3 check read
  `{p0, p1, size_mm}` structurally, which v4 has not — calibration is a list of points that
  legitimately starts empty, so "uncalibrated" is a state the editor reports rather than an error to
  refuse a save over.

Feedback is a Shoelace `sl-alert` toast (`_notify`), not `alert()`.

---

### `rr-header`

Top app bar. Renders the view toggle, the status slot, and the settings gear; hosts
`rr-settings-dialog` and opens it imperatively via its `show()` method.

| Property | Type | Description |
|---|---|---|
| `viewMode` | `'editor' \| 'live'` | Selects the toggle icon and tooltip |
| `layout` | `object` | Passed through to `rr-settings-dialog` |

| Slot | Content |
|---|---|
| `status` | Status text; falls back to "Occupancy UI" |

**Emits:** `rr-view-toggle` (no detail).

---

### `rr-settings-dialog`

Layout metadata, in an `sl-dialog` with a single "Layout" tab: name, scale (from `VALID_SCALES`),
description, and contact.

| Property | Type | Description |
|---|---|---|
| `layout` | `{ name?, scale, description?, contact? }` | Current layout; defaults to scale `N` |

**Methods:** `show()`, `hide()`.

**Emits:** `rr-layout-change` with `{ layout: Partial<Layout> }` — one changed field per event.

Text fields fire on **`sl-change`** (blur or Enter), not `sl-input`. Per keystroke, each character
would become its own undo entry, so Cmd+Z would chew backwards through a name one letter at a time.
One entry per editing session is the unit the user perceives.

The "Ref Size (mm)" input is gone: it wrote v3's single `size_mm`, and v4's calibration points each
carry their own world coordinate instead.

Classifier selection is **not implemented**: there is no classifier tab, and the
`rr-classifier-change` event named in the source JSDoc is never fired. Classifier config comes from
`models/config.json` at runtime and is deliberately not stored in the manifest.

---

### `rr-toolbar`

Vertical palette for the editor: file actions and undo/redo.

| Property | Type | Description |
|---|---|---|
| `canUndo` | `boolean` | Enables the undo button |
| `canRedo` | `boolean` | Enables the redo button |
| `undoLabel` | `string \| null` | Phrase for the tooltip — "Undo delete image" |
| `redoLabel` | `string \| null` | As above, for redo |

**Emits:** `rr-file-new`, `rr-file-open`, `rr-file-save`, `rr-undo`, `rr-redo`.

The buttons are not a duplicate of the keyboard shortcuts. Their **disabled state** is the only
signal separating "the stack is empty" from "the undo landed on an image you are not looking at",
and touch devices have no Cmd+Z at all.

The v3 labeling tools (`track`, `train`, `coupling`, `other`, `delete`, `calibrate`) and the
`rr-tool-select` event they fired are gone, along with `activeTool` and `disabled`. **The palette
did not come back here**: [#31] gave it its own element, `rr-tool-palette` below, so file actions and
tool selection stay separable.

---

### `rr-tool-palette`

Selects the active tool, and carries the **calibration gate**.

| Property | Type | Description |
|---|---|---|
| `tool` | `EditorTool` (`'calibration' \| 'sensor' \| 'car'`) | The active tool. The editor owns it |
| `calibrated` | `boolean` | Whether DPT resolves. False disables every gated tool |

**Emits:** `rr-tool-select` `{ tool }`. Nothing is emitted for a disabled tool, or for the tool that
is already active.

**While `calibrated` is false the sensor and car tools are disabled and the reason is stated.** The
reason names **DPT** rather than the width rectangle. The rectangle is why the *car* tool is gated —
car width is derived rather than stored, so an uncalibrated archive cannot draw what tells a user
whether a label covers the car — but a sensor is a single point and would draw fine uncalibrated, so
blaming the rectangle would put a false reason on the one tool whose gating is a deliberate
deviation. Calibration itself is never gated: it is the tool that *produces* the DPT.

The reason lives in the page (`.gate-reason`), not in the buttons' tooltips: a disabled
`sl-icon-button` takes no pointer events, so a tooltip on one never opens. The gate is on **existence, never completion** (`../SPEC.md`
§ Labeling Workflow) — two points at a nonzero separation, which is exactly "`getDPT` returns a
number" — and it opens and closes live, so an undone calibration disables the tools again.

> The sensor tool is gated with the car tool at [#31]'s request, one step beyond `../SPEC.md`
> § Labeling Workflow ("sensors can be placed at any time"). `needsDpt` is per tool in the source, so
> that is one flag to flip if it is revisited.

The `car` tool authors a two-click span through `rr-editor-view` ([#32]); this element only says
which tool a click means.

---

### `rr-sensor-dialog`

Asks for a sensor's **optional** name. Opened imperatively with `show(name, { id })`, like
`rr-calibration-dialog`, because the value it starts from belongs to the gesture.

**Emits:** `rr-sensor-name-commit` `{ name: string | null }`. `null` is "no name" — a cleared field
is how a name is *removed*, and the editor writes that as the absence of the key rather than as `""`.

Naming is separate from placing, because a sensor with no name is complete: consumers key on `id`,
and `name` is optional passthrough that is never auto-generated (`../SPEC.md` § Occupancy Output).
The dialog shows the id it is naming, which is what the editor displays in its place.

---

### `rr-thumbnail-bar`

Horizontal strip of image thumbnails, with drag-and-drop reordering.

| Property | Type | Description |
|---|---|---|
| `images` | `string[]` | Image URLs (blob URLs) |
| `selectedIndex` | `number` | Currently selected image; `-1` for none |

**Emits:** `rr-image-select` `{ index }`, `rr-image-delete` `{ index }`, `rr-image-add`
`{ source: 'camera' | 'file' }`, `rr-image-reorder` `{ from, to }`.

---

### `rr-viewer` ⭐ shared by both views

Displays media — image or video — under an SVG marker overlay, and reports pointer gestures in
image pixel coordinates.

| Property | Type | Description |
|---|---|---|
| `src` | `string \| null` | Image URL (editor mode) |
| `stream` | `MediaStream \| null` | Video stream (live mode) |
| `markers` | `MarkerData[]` | Markers to draw |
| `calibrationPoints` | `readonly CalibrationPoint[]` | Crosshairs to draw; empty in the live view |
| `sensors` | `readonly Sensor[]` | Diamonds to draw. Per **layout**, so the same list draws over every image; empty in the live view |
| `cars` | `readonly CarLabel[]` | Car spans to draw: a chord inside its width rectangle. Per **image**, so switching images swaps the whole list; empty in the live view |
| `pendingCar` | `PendingCar \| null` | The **rubber band** — `{ anchor, to }` for the chain in flight. The one thing here that is not in the manifest; empty in the live view |
| `dpt` | `number \| null` | The scale the **world-sized** symbols are drawn at. `null` falls them back to `symbolSize` |
| `resolution` | `{ width, height }` | Native media resolution → the SVG viewBox |

**Emits:** `rr-pointer-down`, `rr-pointer-move`, `rr-pointer-up`, `rr-pointer-cancel`
(`ViewerPointerDetail`), and `rr-pointer-contextmenu` (`ViewerContextMenuDetail`). All five fire in
both `src` and `stream` mode. They are declared in `HTMLElementEventMap`, so a listener anywhere up
the tree gets the detail typed without a cast.

| Detail field | Type | Description |
|---|---|---|
| `point` | `Point` | Position **in image pixels** — the SVG viewBox frame, never screen coordinates |
| `imagePxPerScreenPx` | `number` | Converts a screen-space tolerance to image pixels; feeds `geometry.ts`'s `HitTolerance` |
| `originalEvent` | `PointerEvent` / `MouseEvent` | For `pointerId`, `buttons`, and modifier keys |

**Coordinates are converted with `createSVGPoint` + inverse `getScreenCTM()`**, never by subtracting
`getBoundingClientRect()` by hand: the rect ignores the letterbox that `preserveAspectRatio` creates,
so the hand-rolled version is correct only while the viewport happens to match the image's aspect
ratio, and drifts silently as soon as it does not. `imagePxPerScreenPx` comes off the same matrix for
the same reason. Where no CTM is available — jsdom, a detached element — **nothing is emitted**
rather than a coordinate derived from a missing transform.

`point` may fall **outside** the image bounds: the overlay covers the letterbox bars, and a captured
drag keeps reporting after the pointer leaves the element. Clamping is the consumer's call.

**Pointer capture is taken on `pointerdown`** and released on up or cancel, so a drag that wanders
off the element still delivers its end. `pointercancel` is reported as its own event rather than
folded into `up`, because a consumer that commits an edit on `up` must not commit a gesture the
browser took away.

**The overlay is now the hit target** — `pointer-events` on the SVG went from `none` to `auto`. That
makes the `touch-action: none` already on the same rule *effective*, where before touches fell
through to the `<img>`/`<video>` underneath: pinch-zoom over the media is suppressed on touch
devices, and dragging the photo no longer starts the browser's native image drag. Deliberate — the
labeling surface has to own its gestures — but it is the one user-visible consequence of the change,
and the labeling device is a phone.

**It still authors nothing** — `calibrationPoints` is drawn from the manifest and never written here,
exactly like `markers`. `interactive`, `activeTool`, `calibration`, and the four events that
mutated (`rr-marker-add`, `rr-marker-move`, `rr-marker-delete`, `rr-calibration-move`) were removed
in the v4 reduction and do not come back — v4 has neither point markers nor a draggable `{p0, p1}`
pair. The viewer reports where the pointer is; deciding what that means is the editor's job, and the
arithmetic it needs is in `geometry.ts`. The right-click is **not** `preventDefault()`ed here, since
whether the native menu is suppressed depends on editor state: `rr-editor-view` suppresses every
right-click it hears, and `rr-live-view` does not listen at all.

**Methods:** `getVideoElement()`, `getImageElement()` — `rr-live-view` uses these to feed the
classifier the live frame source.

**Why one component for both modes.** `<img>` and `<video>` both use `object-fit: contain`, matched
to the SVG's `preserveAspectRatio="xMidYMid meet"`, and the SVG overlays the full viewport. The
viewBox therefore maps 1:1 onto image pixel coordinates, so a marker lands in the same place in
either mode. Changing one half of that pair silently misplaces every marker.

**Scaling — two kinds, and mixing them up misdraws everything.** A `ResizeObserver` recomputes
`symbolSize = MARKER_SIZE_PX * (resolution.width / svgRect.width)`, keeping markers, crosshairs,
car endpoint handles and every **label** a constant *screen* size at any zoom or window size. A
**sensor's diamond** is not one of those: it is drawn one **track width** across, which in image
pixels *is* `dpt` (`geometry.ts` § `trackWidthPx`), so it shrinks with the photograph exactly as the
cars around it do. A **car's width rectangle** is the same kind of size, 2.09 track widths of it,
which is what makes a sensor's footprint comparable to a car's.

With `dpt` null the diamond falls back to `symbolSize` and the width rectangle is **not drawn at
all** — a car with no derived width has none to claim, where a sensor with no size would simply be
unfindable. An archive can carry both and no calibration, since a calibration point can be deleted
at any time; the chord and its handles keep every car visible and grabbable meanwhile.

**Cars are drawn first**, under the crosshairs and diamonds: their rectangles are the only area
fills on the overlay, and a calibration point or a sensor sitting on a car must not be tinted over.
The shared coupler handles go over the cars they join, and the rubber band over those — a chain in
flight has to stay legible on the train it is being added to.

**Couplings are derived here, not passed in** ([#33]). `geometry.ts`'s `couplerPoints` reads them off
`cars` — exact coincidence, the same rule the hit-test grabs by — so a coupling renders as **one**
shared handle and the cars underneath leave their own handles off at that end. Two circles stacked on
one pixel would only ever *look* like one, and could not say they are shared. Nothing about a
coupling is stored, and nothing needs to be: dragging the handle moves every end under it.

**A car's class warning is derived here too** ([#35]), for the same reason a coupling is: it is a
property of the label this component was handed and of a build-time constant, so there is nothing for
a parent to compute or to keep in sync. `vocabulary.ts`'s `isKnownClass` decides, `carMarker.ts`
draws it. The live view passes no cars, so nothing there is affected.

**The measurement happens in `firstUpdated()` as well as in the `ResizeObserver`.** The observer's
callback defers through `requestAnimationFrame`, and a frame that never arrives — a hidden pane, a
background tab, an occluded window — used to leave every screen-constant symbol at its initial ratio,
drawing crosshairs and labels at whatever size the *image* pixels happened to be. jsdom reports every
rect as zero, so the suite cannot catch that; it was found by measuring a live page.

---

### `marker.ts`

Marker rendering for SVG. It is a module rather than a custom element because custom elements break
the SVG namespace when nested inside `<svg>`. **All three exports must be used together** — the
module boundary is the encapsulation.

| Export | Type | Description |
|---|---|---|
| `renderMarker(marker, size)` | `(MarkerData, number) => SVGTemplateResult` | One marker: `<title>` tooltip, `<use>` of the type symbol, and a validation rect when `status` is set |
| `markerDefs()` | `() => SVGTemplateResult` | The `<defs>` block; must appear once inside the host `<svg>` before any marker |
| `markerStyles` | `CSSResult` | Validation-rect colors and stroke behavior; must go in the host's `static styles` |

Symbols defined: `track`, `train`, `coupling`, `other`. (`drag-handle` went with calibration
dragging.) Each is a 24×24 viewBox centered on (0,0), so `<use transform="translate(x,y)">` places it
centered without manual offsets. An unrecognized `type` falls back to `other`.

**`MarkerData`**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique marker id |
| `x`, `y` | `number` | Image pixel coordinates |
| `type` | `'track' \| 'train' \| 'coupling' \| 'other'` | Marker category |
| `status?` | `'match' \| 'mismatch' \| 'pending' \| null` | Validation ring: green / red / orange. Omit or `null` for no ring |
| `detectedLabels?` | `string[]` | What the classifier returned; shown as the `<title>` tooltip |

> **`status` and `detectedLabels` currently have no producer.** The editor set them to show per-marker
> classification results, and that went with the v4 reduction; `rr-live-view` passes `status: null`.
> The rendering is kept rather than deleted because sensor state and L0 boxes will both want a
> per-marker visual — but until something sets them, the validation ring and the tooltip do not
> appear. Don't read the table above as describing live behaviour.

---

### `geometry.ts`

The editor's geometry, as pure functions. A module rather than anything inside a component, and that
placement is the point: jsdom neither lays out nor paints, so arithmetic living in a Lit element is
untestable until `@web/test-runner` is stood up, while the same arithmetic here is covered today.

| Export | Description |
|---|---|
| `trackWidthPx(dpt)` | Track width in image pixels — which **is** DPT, since `getDPT` returns px/mm × gauge_mm. A sensor is drawn one of these across |
| `sensorDiameterPx(dpt, imagePxPerScreenPx)` | The diameter a sensor is **drawn** at: one track width, or the screen-constant size with no DPT. The renderer and the hit-test share it, so what you see is what you can grab |
| `SYMBOL_SIZE_SCREEN_PX` | Size of a screen-constant symbol (markers, crosshairs, labels), in screen pixels |
| `carWidthPx(dpt)` | Car width in image pixels: `dpt × STANDARD_WIDTH / STANDARD_GAUGE` — 2.09 track widths |
| `carCorners(p0, p1, dpt)` | The four corners of the oriented rectangle, in polygon order from the `p0` side |
| `hitTest(scene, at, tolerance)` | The `HitTarget` under an image-pixel coordinate, or `null` |
| `HitScene` | `{ cars, sensors, calibrationPoints, dpt }` — everything grabbable for one image of one layout, plus the scale the world-sized ones are drawn at |
| `HitTarget` | `car-endpoint` / `coupler` (both carrying `ends`), `sensor` (`id`), `calibration` (`index`) |
| `HitTolerance` | `{ screenPx, imagePxPerScreenPx }` |
| `dragHandles(hit, scene)` | The points a grab moves — **a list**, one per object, and two or more for a coupler |
| `DragHandle` | `{ ref, from }`: what it addresses, and where it sat at pointer-down |
| `HandleRef` | `calibration` (`index`), `car-end` (`id`, `end`), `sensor` (`id`) — never an object reference |
| `dragTo(handle, delta)` | Where that handle lands, in whole image pixels |
| `samePoint(a, b)` | Whether two pixels are the same pixel — the **one** encoding of the coincidence rule, shared by the hit-test, the renderer and the staleness guards |
| `couplerPoints(cars)` | Every pixel where two or more car ends meet, once each, in scene order — the couplings a renderer draws one shared handle per |
| `isCoincident(at, points)` | Whether `at` is exactly one of them |
| `coupledEnds(car, couplers)` | `CoupledEnds` for one car: which of its ends a shared handle covers |
| `CoupledEnds` | `{ p0, p1 }` — passed to `renderCar` so it draws no handle there |
| `cardinalDirection(from, to)` | `left` / `right` / `up` / `down`, or `null` for the same point. Names *which* car a coupler's menu row acts on |
| `DEFAULT_GRAB_RADIUS_SCREEN_PX` | The grab radius every tool uses, in screen pixels — one number, because it describes the pointing device. A **floor**, not a cap: a sensor is grabbable across its whole drawn symbol |
| `CLICK_SLOP_SCREEN_PX` | How far a pointer may travel between press and release and still be a click. Smaller than the grab radius: this is tremor, not aim |
| `isClick(from, to, tolerance)` | Whether a finished gesture was a click rather than a drag |
| `placeLabel(at, text, fontSizePx, offsetPx, frame)` | Where a symbol's label goes so it does not run off the frame — up and to the right, flipped inwards at the top or right edge |
| `clampToViewport(at, size, viewport, margin)` | Moves a box so it stays inside the viewport, keeping `margin` from every edge. The one function here in **screen** coordinates — it places the context menu on the glass. A box bigger than the viewport pins to the near edge |
| `Size` | `{ width, height }` — a box on the screen, as opposed to `FrameSize`, which is the image |
| `LabelPlacement` | `{ x, y, textAnchor, dominantBaseline }` — the SVG attributes that place the label |
| `estimateLabelWidthPx(text, fontSizePx)` | An **estimate** of a monospace label's width: character count × 0.6em |
| `FrameSize` | `{ width, height }` — the image bounds, `rr-viewer`'s `resolution` |

**Both constants come from `@occupancy/config`.** The scale ratio cancels out of the width formula —
a car is 2.09 track-widths wide in **every** scale — so no scale lookup belongs anywhere in `ui/`,
and no gauge arithmetic is reimplemented here.

**The grab radius is in screen pixels**, converted with the `imagePxPerScreenPx` that `rr-viewer`
puts in every pointer event. A grab radius is a property of the mouse and the finger, not of the
photograph: an 8-megapixel image and a 720p one must feel the same.

**Nearest wins**, whatever its kind; an exact tie goes to the denser geometry (car ends, sensors,
calibration points, in that order). Only handles are hit — the body of a car is not grabbable,
because the only edits a span supports are to its two ends.

**A coupler is exact coincidence, not proximity.** Nothing about a coupling is stored; it is two or
more car ends at the identical pixel, which chaining and the shared handle both guarantee by writing
the same value. Fusing endpoints that merely look close would move geometry the user never joined.
`hitTest` and `couplerPoints` apply that one rule to the pointer and to the renderer, so what draws
as a coupling is exactly what grabs as one.

**A car has no name, so a coupler's menu names it by direction.** `cardinalDirection` is that, and
it is why the rule resolves an exact diagonal instead of calling it a tie: two cars coupled end to
end run in opposite directions, opposite vectors land in opposite quarters, and the two rows can
therefore never read the same.

**A drag is a list of handles, not the thing under the cursor.** `dragHandles` is where that
conversion happens, and it is why one history entry can cover several objects. Every handle carries
the position it had at pointer-down, and `dragTo` applies the same delta to each: measured from the
press so the grab offset survives — grabbing a point three pixels off-center must not teleport it
under the cursor — and identical across handles so a coupler's ends land on the *same* pixel, which
is what keeps them coupled. Rounded, because a handle names a pixel.

**A label flips inwards rather than being clipped.** `placeLabel` prefers up and to the right, and
draws on the inside — to the left near the right edge, below near the top — when it would otherwise
run past the frame. Only the axis that overflows flips, and only when the other side actually fits: a
frame narrower than the label overflows either way, and flipping there would trade a clipped tail for
a clipped head, losing the leading digits that identify the point. The symbol itself never moves;
a calibration crosshair still names its exact pixel on the edge.

**The width behind that decision is an estimate, and is named one.** Nothing here measures text:
`measureText` and `getBBox` need layout, jsdom performs none, and a rule depending on them would be
untestable — which is the reason this module exists. Every editor label is monospace and its content
is known, so `estimateLabelWidthPx` is character count × 0.6em, erring slightly wide, which is the
safe direction for a flip test. It is not a box the glyphs are guaranteed to sit inside. The rule
lives here rather than in a renderer because the sensor symbol carries a name in the same frame
against the same edges: its geometry differs, this decision does not.

---

### `calibrationMarker.ts`

The calibration point's own SVG, as a module for the same reason `marker.ts` is one. **Both exports
must be used together** — styles in the host's `static styles`, the renderer once per point.

| Export | Type | Description |
|---|---|---|
| `renderCalibrationPoint(point, index, size, frame)` | `(CalibrationPoint, number, number, FrameSize) => SVGTemplateResult` | A crosshair centered on `point.px`, a small circle at the exact pixel, and a `text` label carrying the world coordinate. `size` is in image pixels — `rr-viewer`'s `symbolSize`, so the crosshair is constant on screen; `frame` is its `resolution` |
| `calibrationMarkerStyles` | `CSSResult` | Crosshair and label colors, non-scaling strokes, and the label's own outline |

There are no `<defs>` and so no third export: a crosshair is two lines, and nothing is reused.

A calibration point is drawn **unlike anything else in the editor** by requirement (`../SPEC.md`
§ Reference points) — it must not be confusable with the sensor symbol, which is why that one is a
closed amber diamond and this one is two cyan crossing arms. The
crosshair also names the exact pixel, which a boxed icon does not. The label rounds to one decimal:
coordinates are typed by hand today, but a dragged point will not be, and float noise in a label
reads as a bug in the editor.

Points carry **no `id`** — nothing references one individually — so `index` (position in
`layout.calibration.points`) is the only handle a gesture has, and it is rendered as
`data-calibration-index`.

**`frame` is only the label's business.** The label sits up and to the right by default and would be
clipped on a point near the top or right edge, so it flips inwards; the decision is `geometry.ts`'s
`placeLabel`, shared with `sensorMarker.ts` rather than inlined here, and made from an
*estimated* label width because nothing can measure text. `text-anchor` and `dominant-baseline` are
therefore set **per element** and are deliberately absent from `calibrationMarkerStyles` — a
stylesheet rule beats a presentation attribute and would pin every label to one corner. The crosshair
ignores `frame` entirely: it names an exact pixel, wherever that pixel is.

---

### `vocabulary.ts`

The authored class taxonomy, read as a tree. A pure module for the same reason `geometry.ts` is one,
and the **only place in `ui/` that a class name comes from** — every value here is derived from
`detector.vocabulary` in `config.yaml`, reached through the generated `@occupancy/config`, so adding
a subtype there and running `pnpm config:generate` changes the editor's menu with no code edit.

| Export | Description |
|---|---|
| `rootClass(vocabulary?)` | The taxonomy's single root — the class every new car is created as. Throws unless there is exactly one |
| `classChoices(vocabulary?)` | The root's children as a nested `ClassChoice[]`, each carrying its full dotted `class`, its `name`, and its own children |
| `isKnownClass(cls, vocabulary?)` | Whether a stored class names an entry. Segment by segment, the same rule the exporter maps with: `stock` matches `stock.loco` but never `stockyard` |
| `VocabularyNode` | One mapping in the taxonomy: subtypes by name, mixed with the node's own properties |
| `ClassChoice` | `{ class, name, children }` |

Two rules it encodes, each wrong somewhere if reimplemented:

* **A nested object is a subtype; anything else is a property.** `width_mm` is an optional per-class
  width override sitting beside subtypes in the same mapping, and telling the two apart structurally
  is what avoids a reserved list of key names.
* **The stored class is always rooted, and the root is never shown.** A label maps to the longest
  entry of `detector.classes` that is a segment-prefix of its class, so an unrooted `loco.steam`
  matches nothing and is **dropped from the export** — the unlabeled-car-as-background failure the
  completeness rule exists to prevent.

Conformance is checked **here and not at parse time**: `class` is a plain string at the format layer
(`../SPEC.md` § Format), because a format that refused to open files because someone pruned
`config.yaml` would punish config edits. So a non-conforming class is a visible warning in the editor
(`rr-viewer` marks the car red and names the class) and a fatal error in the training exporter later.

---

### `sensorMarker.ts`

The sensor's own SVG, with the same shape and the same rules as `calibrationMarker.ts`. **The exports
must be used together** — styles in the host's `static styles`, the renderer once per sensor.

| Export | Type | Description |
|---|---|---|
| `renderSensor(sensor, size, frame)` | `(Sensor, SensorSymbolSize, FrameSize) => SVGTemplateResult` | A diamond centered on the sensor, a filled core at the exact pixel, and a `text` label. `frame` is `rr-viewer`'s `resolution` |
| `SensorSymbolSize` | `{ diameterPx, labelPx }` | **Two independent sizes.** `diameterPx` is a *world* size — one track width, so the diamond shrinks with the photograph; `labelPx` is a *screen* size, from the viewer's `symbolSize` |
| `sensorLabelText(sensor)` | `(Sensor) => string` | The sensor's `name`, or its `id` when it has none |
| `sensorMarkerStyles` | `CSSResult` | Diamond and label colors, the translucent fill, non-scaling strokes |

**Amber diamond against the crosshair's cyan arms**, and the difference is shape as much as colour: a
sensor and a calibration point are different objects with different tools, and `../SPEC.md`
§ Reference points requires them to be unmistakable. The symbol also *closes* around its pixel rather
than extending arms, because a sensor is a single query point and nothing about it implies an extent.

**The diamond is one track width across**, not a constant size on screen — the only honest sense of
how big a sensor is comes from the track it sits on, and a car is 2.09 of the same unit, so the two
are directly comparable on the photograph. The **label is a screen size**, because it is annotation
about the sensor rather than a measurement of it: a name scaled to the track is illegible at the
DPT 18–19 the fixture corpus sits at. The centre dot has a **floor** (`MIN_CORE_RADIUS_PX`): it names
the pixel the sensor *is*, and 12% of an 18-pixel diamond is not a visible dot.

**An unnamed sensor is labelled with its `id`.** Names are optional, free text, not unique, and never
auto-generated (`../SPEC.md` § Occupancy Output): an invented "Sensor 3" is indistinguishable from a
name a human chose and stops matching as sensors come and go. A blank name is treated as no name.

`frame` is the label's business only, exactly as for the crosshair, and through the same
`placeLabel`.

---

### `carMarker.ts`

The car's own SVG, with the same shape and the same rules as the two markers above. **The exports
must be used together** — styles in the host's `static styles`, the renderers over the scene.

| Export | Type | Description |
|---|---|---|
| `renderCar(car, size, coupled?, warning?)` | `(CarLabel, CarSymbolSize, CoupledEnds?, CarWarning \| null) => SVGTemplateResult` (`CoupledEnds` is `geometry.ts`'s) | The translucent width rectangle, the chord between the two ends, and a handle at each **free** end. The group carries `data-label-id`, and `unknown-class` when a warning is given |
| `renderCoupler(at, size)` | `(Point, CarSymbolSize) => SVGTemplateResult` | The **one shared handle** a coupling renders as — half again the size of a free end's, ringed so it reads as a joint |
| `renderPendingCar(pending, size)` | `(PendingCar, CarSymbolSize) => SVGTemplateResult` | The **rubber band**: the car the next click would write, dashed, rectangle and all |
| `CarSymbolSize` | `{ dpt, handlePx, labelPx }` | The **DPT the rectangle is derived from** — not a width — plus screen-constant handle and warning-label sizes |
| `CarWarning` | `{ text, frame }` | A class the vocabulary does not name: the offending class, and the image bounds the label flips inside |
| `PendingCar` | `{ anchor, to }` | The chain in flight: the end already clicked, and where the pointer is |
| `carMarkerStyles` | `CSSResult` | Rectangle, chord, handle, coupler and band colours; the translucent fill; the band's dashes; non-scaling strokes |

**The rectangle is why the car tool is gated on calibration.** Two clicks say where the ends are and
nothing about whether the label covers the car; the width does, and the width is *derived* from DPT
rather than stored — 2.09 track widths, in every scale (`geometry.ts` § `carWidthPx`). So it is
feedback, not decoration, and the fill is translucent because it is read **against the car
underneath it**.

**The DPT is passed, not a width.** The derivation lives in `geometry.ts` and a caller handing over
a number would be a second place to get the 2.09 wrong. `null` is a real state — a calibration point
can be deleted at any time — and it means no rectangle: the chord and the two handles still draw, so
the labels already authored stay visible and grabbable.

**Magenta**, against the crosshair's cyan and the diamond's amber, and picked to be rare in a
photograph of a layout. Three objects, three tools, three meanings; `../SPEC.md` § Reference points'
requirement that they be unmistakable extends to this one.

**A coupling renders as one handle, and the cars get out of its way** ([#33]). The caller derives the
couplings with `geometry.ts`'s `couplerPoints` and tells each car which of its ends is covered;
`renderCoupler` then draws the shared handle once, however many ends meet there. Nothing about the
coupling is *stored* — it is still only the coincidence — but it is drawn, because one handle is the
promise the drag keeps.

**A class the vocabulary does not name draws red and says so** ([#35]). `class` is a plain string at
the format layer and is deliberately **not** validated when an archive is parsed (`../SPEC.md`
§ Format) — a format that refused to open files because someone pruned `config.yaml` would punish
config edits — so the editor is where non-conformance becomes visible, and the exporter is where it
becomes fatal. The whole symbol changes ink rather than gaining a badge (the label is *wrong*, not
annotated), the offending class is drawn beside the car's midpoint because a typo is the likely
cause, and the car is still drawn whole because the archive still opens. This is the one text a car
carries, hence the one place `carMarker.ts` needs a frame — the label flips inwards at an edge
through the same `placeLabel` the sensor's name uses.

**The band is dashed, and it draws the whole car.** A chain in flight is view state and must never
read as a label that has been written, hence the dashes; and it shows the derived width rectangle
rather than a bare line, because that rectangle is the only feedback that a label covers the car and
seeing it *before* the click is worth more than seeing it after. Before the pointer moves it is the
anchor twice over — one handle, a collapsed rectangle — which is the feedback that the first click of
a chain landed.

**Handles are a screen size, the rectangle is a world size.** A handle is where the pointer grabs,
so it belongs to the mouse; the rectangle measures the car. Same split as `SensorSymbolSize`.

---

### `rr-calibration-dialog`

Asks for a calibration point's world coordinate in millimetres — the second half of the gesture whose
first half is a click on the image.

**Properties:** none. It is opened imperatively, because the values it starts from belong to the
gesture rather than to any parent state.

**Methods:** `show(world?, { mode? })` — `mode` is `'place' | 'edit'` and changes wording only;
`hide()`.

**Emits:** `rr-calibration-commit` with `{ world: WorldPoint }`. Cancelling emits nothing, which is
what keeps a dismissed dialog out of the manifest *and* out of the undo stack.

The fields are written imperatively in `show()` rather than value-bound: reopening on the same
coordinate after the user typed something else would otherwise leave the stale text, since the
binding sees no change. A blank field is **refused, not read as zero** — the origin is a real
position in the layout's frame, so defaulting to it would place a point somewhere specific with
nothing saying so. Enter commits, which is how a three-field numeric form is typed.

`show()` deliberately does not await `sl-dialog.show()`: that promise resolves on `sl-after-show`,
i.e. when the opening animation finishes, and the caller is waiting only for the fields.

---

### `rr-context-menu`

The right-click menu: a short list of verbs acting on one object. It is why the editor needs no
delete mode at all — deleting is a verb on the thing under the cursor rather than a mode the user
enters and must remember to leave (`../SPEC.md` § Right-click is state-dependent).

**Properties:** none. Opened imperatively, like `rr-calibration-dialog` and for the same reason: what
it shows belongs to the gesture that opened it. Nothing is rendered while it is closed.

**Methods:** `show(at, items)` — `at` is a `ScreenPoint` in **client** coordinates, `items` is
`ContextMenuItem[]`; resolves once the rows are in the DOM. `hide()`. `open` is a read-only getter.

| Type | Shape | Description |
|---|---|---|
| `ContextMenuItem` | `{ id, label, items? }` | `id` is reported on selection and never shown; `label` is what the user reads; `items` nests a **submenu**, to any depth |
| `ScreenPoint` | `{ x, y }` | Named apart from `Point` on purpose — every other editor position is in **image** pixels; a menu is placed on the glass |

**Emits:** `rr-context-menu-select` with `{ id }`. Dismissing emits nothing.

**It knows nothing about what the object is.** The editor hit-tests, names the verbs, and interprets
the selection; this element renders rows and reports which one was chosen. That is what lets cars,
sensors and the reclassify submenu ([#35]) plug into the same menu as they arrive.

**A row with children is opened, never chosen.** It carries no `value` — only `data-id` — so a stray
selection cannot report an id that names no verb, and a nested selection is reported by the child's
own id. One click reports **one** selection however many menus it bubbles through: a nested `sl-menu`
and the outer one share this element's listener, and a second report would be a second history entry
for one gesture.

**Dismissal is on the document**, in the capture phase: a press anywhere outside the element (tested
with `composedPath()`, which sees through the shadow boundary) and Escape. A menu the user has to aim
at in order to close is worse than no menu. The listeners are added on `show()` and dropped by
`hide()`, which `disconnectedCallback()` calls — a document listener outliving the element would
swallow presses for the rest of the session.

**The dismissing press is swallowed** (`stopPropagation` + `preventDefault` in the capture phase), as
it is for a native menu. Without that it reaches `rr-viewer` underneath and the editor reads it as a
click, placing a calibration point behind the menu the user was only closing.

**Position** is written as `--menu-x` / `--menu-y` on the host, which `position: fixed` styles read.
`updated()` measures the rendered menu and runs it through `geometry.ts`'s `clampToViewport` so it
stays inside the window — in the element only because that is where the measurement is; the
arithmetic is in `geometry.ts`, where a test can reach it. With an unmeasured menu (jsdom, every rect
zero) the clamp is the identity and the menu lands at the cursor.

---

### `rr-editor-view`

Orchestrates the editor: images, a DPT readout, the active tool, calibration, sensor and car
authoring, and the right-click menu.

| Property | Type | Description |
|---|---|---|
| `archive` | `R49Archive \| null` | |
| `history` | `EditHistory \| null` | The undo stack; every mutation below runs through it |
| `canUndo` / `canRedo` | `boolean` | Passed through to `rr-toolbar` |
| `undoLabel` / `redoLabel` | `string \| null` | Passed through to `rr-toolbar` |

**Emits:** `rr-history-change` after recording an edit.

**Methods:**

* `syncFromArchive(revealFilename?)` — rebuilds the blob URLs and optionally selects an image, and
  ends any chain in progress. Called by `rr-app` after undo or redo, which is how an entry scoped to
  another image brings that image into view before the change lands.
* `interceptUndo()` — `Promise<boolean>`. `rr-app` offers every undo here first, because **a live
  chain is a wall undo cannot cross** and only this component knows one is live ([#33]). See
  *Chaining* below.

* Creates blob URLs for every image in the manifest, revoking the previous set on reload.
* Image add (camera or file), delete, and reorder go through the corresponding `R49Archive` methods,
  each wrapped in `history.record` with target `images`. Deletion passes `retain` so the image's
  bytes survive for undo.
* **Calibration authoring.** A **click** in the viewer — `rr-pointer-down` then `rr-pointer-up`
  within `CLICK_SLOP_SCREEN_PX`, on the same `pointerId` — is hit-tested against the layout's
  calibration points with `DEFAULT_GRAB_RADIUS_SCREEN_PX`. A hit opens `rr-calibration-dialog`
  prefilled on that point; a miss opens it blank and remembers the clicked pixel, **rounded to a
  whole pixel** — a click has no sub-pixel precision to store. The commit writes the point as
  **exactly one `history.record` entry targeting `layout`**, labelled "place calibration point" or
  "edit calibration point", and undo reverses it. Nothing is written until the coordinate arrives, so
  a dismissed dialog leaves both the manifest and the stack untouched.
  * Everything is decided at **pointer-down** — the hit-test, the handles the gesture will move, and
    the history entry it will commit — so no motion event re-decides anything and the entry's
    snapshot predates the first moved pixel. The **press** position is what a click uses: where the
    user aimed, and where a drag grabs.
  * The hit-test scene contains the layout's calibration points and sensors and the **current
    image's** cars — the three objects this editor creates. That split is the per-image/per-layout
    rule as a gesture sees it: switching images swaps the cars and leaves the sensors.
* **Dragging** ([#30]). A press on a calibration point followed by motion past `CLICK_SLOP_SCREEN_PX`
  moves it, and the DPT readout follows live, mid-gesture. The history entry is opened at
  pointer-down and committed at pointer-up, **never per motion event**, so a drag across the image is
  one Cmd+Z and not two hundred; a drag returned to its origin records **nothing**, suppressed by
  value comparison in `EditHistory` rather than by trusting that the user meant it.
  * The gesture moves a **list** of handles from `dragHandles`, which is what lets one entry cover
    more than one object: a drag on two coincident car ends moves both, as **one** entry, so a
    coupling survives the edit. The entry's **target follows what was grabbed** — a car end is in
    one image record, a sensor and a calibration point in `layout` — because that is the subtree the
    gesture writes, and mis-declaring it is the one class of bug scoped snapshots admit.
  * `dragging` is **sticky**: a gesture that moved never falls through to the click path, even if it
    ended back inside the slop. Without it every swipe over the image would place a point, and the
    labeling device is a phone.
  * A press arriving mid-drag is read by its `pointerId`. A **different** one is a second finger and
    is ignored. The **same** one cannot be — a pointer does not go down twice without going up — so
    it means the previous gesture's end never arrived, and it closes that gesture instead of being
    ignored. Without that, one swallowed `pointerup` (`rr-viewer` emits nothing when it has no
    transform) would leave the editor deaf to every press *and* undo dead for the session.
    `disconnectedCallback` closes an open gesture for the same reason: `rr-app` replaces this element
    on the view toggle. Both **commit** what moved rather than reverting it — the objects visibly
    moved and undo covers that; a silent revert would be the editor deciding it knew better.
  * `rr-pointer-cancel` puts every handle back at its starting pixel and closes the entry against an
    unchanged subtree, so a gesture the browser took away records nothing — and is restored even
    when no history is attached.
  * **Pointer capture** is `rr-viewer`'s (it takes it on `pointerdown`); what the editor owes it is
    not bailing on coordinates outside the image, so a drag that leaves the viewer still commits.
  * An edit remembers the **pixel** as well as the index. Points carry no `id`, so if an undo lands
    while the dialog is open and slides that index onto a different point, the commit is dropped
    rather than applied to whatever now sits there.
* **Right-click, and delete** ([#29]). `rr-pointer-contextmenu` is dispatched on the editor's state —
  a `switch` over the `EditorMode` union — because right-click is state-dependent by design
  (`../SPEC.md` § Right-click is state-dependent): **idle** opens the menu and **placing-car** ends
  the chain.
  * The **idle** branch hit-tests at `DEFAULT_GRAB_RADIUS_SCREEN_PX` and opens `rr-context-menu` at
    the cursor: **delete** for a calibration point, **name and delete** for a sensor, **delete and
    reclassify** for a car. Empty image opens nothing, and neither does an object with no verbs — a
    list of disabled rows is a worse answer than the absence of one. A **coupler** offers that pair
    per car that meets there, each row named by the direction that car runs ([#33]) — it has to,
    because the middle car of a three-car train has no free end and the joint is the only way to
    reach it.
  * **Reclassify is a submenu generated from `detector.vocabulary`** ([#35]), through
    `vocabulary.ts`. A new car is the taxonomy's root and refinement is an occasional act, not a
    mode, which is what a submenu says and a persistent picker would not. The **root is never
    rendered** — its children are — and it is nonetheless required in the stored class, so the rows
    carry the full dotted class (`stock.loco.steam`) in the row id. Selecting one is **one `image`
    entry**. A taxonomy that is only a root offers no reclassify row at all.
  * **Every row that acts on a car names it**, coupled or not: `delete-car:<id>` and
    `reclassify:<id>:<class>`, neither ever shown. One id format is one thing to parse, and the
    middle car of a train is reachable through nothing but its joints. A row that only *opens* a
    submenu carries `reclassify-group:…` instead — its own prefix, so it can neither be mistaken
    for a verb nor collide with the row inside it that selects the same subtype.
  * The **placing-car** branch ends the chain and opens nothing. The chain's cars stay: each is its
    own committed entry, and only the anchor — which is view state — goes.
  * **The browser's own menu is suppressed here, not in `rr-viewer`**, and for every right-click the
    viewer reports rather than only the ones that open something: inside the labeling surface a
    right-click is the editor's gesture whatever it lands on, and over empty image it will end a
    chain. `rr-live-view` shares the viewer and does not listen, so its right-click stays the
    browser's.
  * A right-click **during a drag** opens nothing: the object under the cursor is mid-gesture, and
    verbs naming a position the user has not settled on would act on geometry about to change.
  * **Only the primary button authors.** `rr-pointer-down` and `-up` are ignored unless
    `originalEvent.button <= 0`, because a right-click arrives through those same events: without the
    filter the press that opens the menu also runs the click path and puts the calibration dialog up
    behind it. One `pointerId` covers every mouse button, so the filter on `-up` is also what keeps
    the release of a secondary button from committing a left drag still in progress. Touch and pen
    report button 0.
  * The press that **dismisses** the menu is swallowed by `rr-context-menu` and never reaches the
    viewer, so closing a menu over empty image does not place a point.
  * Delete is **one `history.record` entry targeting `layout`**, and undo restores the point with its
    coordinate intact — an entry is a snapshot, so there is no per-object restore to author. The
    subject is resolved when the menu opens and carries its **pixel** for the same reason an edit
    does: an undo landing while the menu is up can slide the index onto another point, and a subject
    that moved is dropped rather than deleted from underneath the user. A **sensor** subject needs no
    such guard: it carries an `id`, so the hit names it exactly however the list is replaced
    underneath — the delete is a filter by id, not a splice by position.
* **The active tool, and the gate** ([#31]). `rr-tool-palette` reports `rr-tool-select`; this
  component holds the tool and dispatches a click on it. A **placement in progress wins outright** —
  the second click of a car is what completes it. Otherwise a click on **empty image** runs the tool
  (calibration opens the dialog, sensor places a point, car takes an anchor) and a click **on an
  object** edits that object *whatever the tool is*, because the thing under the cursor is less
  ambiguous than the mode: a coordinate for a calibration point, a name for a sensor, and **nothing
  at all** for a car end, whose position is the drag's business and whose class is the menu's.
  * The gate is enforced in `willUpdate`, not at the one place a point is deleted: **the DPT can also
    vanish through an undo**, which `rr-app` applies straight into the archive with no handler here
    seeing it. A gated tool is demoted to calibration; placing a second point re-enables it. An
    archive **opens in calibration mode**, and a new archive resets the tool rather than inheriting
    the last one.
* **Sensor authoring** ([#31]). A click with the sensor tool writes `{ id, x, y }` into
  `layout.sensors` as **one `history.record` entry targeting `layout`** — unnamed, which is a
  complete sensor: consumers key on `id`, and `name` is never auto-generated. The `id` is a
  `make_id` snowflake, so it is unique within the layout by construction. Sensors carry **no
  provenance**: no model can propose where a human wants an answer.
  * Naming goes through `rr-sensor-dialog`, opened from a click on the sensor or from the menu's
    "Name sensor…". A commit of `null` **removes** the key; retyping the same name records nothing,
    suppressed by `EditHistory`'s value comparison. The sensor is re-found by `id` at commit, so one
    deleted while the dialog was open is simply gone.
  * Drag and delete reuse the calibration paths unchanged — that is the point of `dragHandles` and of
    the menu knowing nothing about its subject. Both are one `layout` entry.
* **DPT readout** (`.dpt-bar`). `getDPT()` to one decimal, or "Not calibrated" with a warning style
  when it returns `null` — a real v4 state, reported rather than blocked on, and now with the click
  that fixes it. Two further states:
  * **Fit residual** (`getDPTResidual()`), shown only once the fit is over-determined — more than two
    coplanar points. Below that the fit reproduces its input exactly, so a zero would claim an
    agreement nothing checked. It is what makes a mis-typed coordinate visible instead of silently
    absorbed into the scale.
  * **Below `MIN_DPT`**, the bar takes the `below-minimum` warning style and says so. It **blocks
    nothing** — the six fixture archives sit at DPT 18–19, under the threshold of 20, and must stay
    openable and editable.
* **Car authoring** ([#32]). **Two clicks on the visible car ends**, and the straight chord between
  them: no snapping, because v4 stores no track to snap to, and the photograph is what shows the
  labeler where the car actually is. The first click takes an **anchor** and writes nothing; the
  second writes `{ id, class: 'stock', provenance: 'human', p0, p1 }` into that image's `labels` as
  **one `history.record` entry targeting `{ kind: 'image', filename }`**. The `id` is a `make_id`
  snowflake from its own node id — label ids and sensor ids are separate namespaces — and
  `proposed_by` is **absent**, which the schema requires on a human label.
  * Width is **derived, never stored**: `rr-viewer` gets `dpt` and draws 2.09 track widths of
    rectangle around the chord. That rectangle is the whole reason calibration gates this tool.
  * The anchor is **view state**: abandoning a chain — right-click, a tool change, an image change,
    a lost DPT, a new archive — writes nothing and records nothing.
  * A click on an **existing car end** starts nothing while idle. Abutting cars are what chaining is
    for, and a chain's *second* click lands wherever it is aimed, existing end included.
  * Endpoints **drag** and the menu **deletes**, through the same paths as everything else, keyed by
    label `id`. Deleting one car of a train leaves no residue — a train is derived from coincident
    endpoints, so nothing else names the car that went.
* **Chaining a train** ([#33]). The clicks do not stop at two: **every click after the first is
  simultaneously the end of the current car and the start of the next**, so a train is one run of
  clicks. The coincidence a train is derived from is exact because the same pixel is written as one
  car's `p1` and handed straight on as the next one's `p0` — chaining does not record a train, it
  guarantees the coincidence. **Right-click ends the chain**; the next click starts a new one.
  * **One entry per car, never one for the train.** A mis-click on the last coupler of a twelve-car
    consist costs one car (`../SPEC.md` § Undo and redo), and undo does not invent an aggregate the
    format refuses to have.
  * A **rubber band** follows the pointer from the anchor, drawn by `rr-viewer` from `pendingCar`.
    It is what makes a live chain visible, and that visibility is what pays for right-click *and*
    undo meaning something else while one is in progress. The cursor is tracked **only** while a
    chain is live — every other gesture reads its position off the event that carried it.
  * A second click on the **anchor's own pixel** writes no car: a span with no length has no axis and
    no two ends to couple. The chain stays where it was.
  * **Undo is intercepted**, through `interceptUndo()`. While a chain is live it consumes every undo
    — the wall — so the reflexive "wrong place, undo" at the start of a train can never reach back
    into the previous one. Further along it undoes the last car's entry and walks the anchor back to
    where that car began, leaving the chain live one step shorter; at the chain's *start* it clears
    the anchor and drops to idle, touching no history. The anchor steps back **only if that undo
    actually removed the chain's car**: an edit made between two clicks sits on top of the stack, and
    reversing it is nothing to do with the chain.
  * A **coupling renders as one shared handle** and drags as one entry moving every end under it,
    which is what `dragHandles` was shaped for; `rr-viewer` derives the couplings from the cars it
    was handed.
* **It loads no classifier.** Marker CRUD and the per-marker classification display went with the v4
  reduction. See the note at the top of this file.

---

### `rr-live-view`

Camera stream with a real-time classification overlay.

| Property | Type |
|---|---|
| `archive` | `R49Archive \| null` |

* Opens the camera via `getCameraStream()` and runs a `requestAnimationFrame` loop, skipping frames
  until the video reports usable dimensions.
* **Markers come from `manifest.layout.sensors`**, which are per layout, so placing one answers for
  every frame. (v3 used image[0]'s point markers as a stand-in; sensors are what it approximated.)
  Coordinates are scaled from the manifest resolution to the live frame's natural size.
* ⚠️ **This is the demo path, not the occupancy contract.** `../SPEC.md` § Testing and Demo sanctions
  running the classifier over a camera stream for testing and demo. It is *not* L1: § Occupancy
  Output specifies per-sensor state as a **pure function of L0**, the detector's oriented boxes, and
  says outright that "L1 never calls a second model". Nothing here emits `occupied`/`clear`/
  `unknown`, and nothing here should start to.
* Each marker's icon is the highest-priority returned label, ordered train > coupling > track.
* Shows a banner and classifies nothing when `getDPT()` is null, since crop scaling needs it.
* Releases the classifier and stops all camera tracks on disconnect.

---

### `rr-stats-bar`

Overlay showing live classification stats. Displays FPS, marker count, and time per marker.

| Property | Type | Description |
|---|---|---|
| `fps` | `number` | Frames per second |
| `count` | `number` | Markers classified per frame |
| `sampleTime` | `number` | Milliseconds per marker |
| `latency` | `number` | Whole-frame time; set by `rr-live-view` but **not currently rendered** |

---

### `capture.ts`

Camera helpers, shared by both views.

| Export | Description |
|---|---|
| `DEFAULT_CAMERA_CONSTRAINTS` | 1920×1080 ideal, rear-facing, no audio |
| `getCameraStream(constraints?)` | `getUserMedia` wrapper; returns a `MediaStream` |
| `captureFromCamera()` | Opens the camera, grabs one JPEG frame as a `Uint8Array`, and always stops the tracks — with a 5 s timeout |

---

### `history.ts`

The editor's undo stack. A plain module, not an element: `rr-app` owns one instance and passes it
down. It is deliberately **not** part of `@occupancy/r49`, which is a parser/serializer — an edit
history is an editing-session concept, coupled here to view state that means nothing to the training
exporter or to `lib/r49/tests/fixtures.test.ts`.

| Export | Description |
|---|---|
| `EditHistory` | `attach`, `record`, `beginGesture`, `undo`, `redo`, `markSaved`; `canUndo`/`canRedo`/`undoLabel`/`redoLabel`/`isDirty`/`size`/`bytes` |
| `HistoryTarget` | `{ kind: 'layout' }`, `{ kind: 'image', filename }`, or `{ kind: 'images' }` |
| `HistoryEntry` | What `undo`/`redo` return, so the caller can reveal what changed |
| `revealTarget(entry)` | The image an entry must bring into view before it lands, or `undefined`. The navigation invariant in one function — `rr-app` and the chain's own undo both read it |
| `HistoryGesture` | An open gesture. One method, `commit()`, returning whether an entry was recorded |
| `DEFAULT_HISTORY_BUDGET_BYTES` | 256 MB. A UI constant, **not** a `config.yaml` value — nothing outside `ui/` can read it |

Entries are **scoped snapshots** — `before`/`after` clones of the one subtree touched — so undo and
redo are one operation with the fields swapped, and there is no per-command inverse to author
wrongly. Retention is bounded by bytes rather than entry count, because entries range from a
kilobyte to a whole JPEG; eviction truncates the oldest end and never punches a hole.

**`record` brackets one mutation; `beginGesture` brackets a drag.** A drag mutates on every
pointer-move and must still be one Cmd+Z, so the snapshot is taken when the gesture opens
(pointer-down), the caller mutates freely, and `commit()` closes it (pointer-up). `commit()` returns
`false` — recording nothing — when the subtree came back byte-identical, which is how a drag returned
to its origin costs no entry. It is idempotent, because pointer-up and pointer-cancel can both arrive
for one gesture, and `attach` drops an open gesture with the archive it snapshotted.

That **one entry can cover several objects** falls out of the target being a subtree: a coupler drag
moves two cars inside one image record, and a single `{ kind: 'image' }` gesture already covers both.

Two guards follow. **Undo and redo are refused while a gesture is open** — the drag has already
mutated the manifest outside the stack, so applying an older snapshot over it would leave the commit
comparing against a `before` that never existed; the press ends first, and the next Cmd+Z behaves
normally. And `record` inside an open gesture **warns**: the gesture would record the same mutation a
second time.

Because that first guard makes an abandoned gesture expensive — undo would stay dead until the
archive is replaced — every caller owes it an ending. `rr-editor-view` closes one on a repeated
`pointerId` and on disconnect, and `attach` drops one outright. `commit()` pushes its entry **before
it yields**, so closing a stale gesture and opening the next one in the same handler records both.

What is built and what is not: this covers layout metadata, image add/remove/reorder, calibration
points, and the calibration drag. The chain interception described in `../SPEC.md` § Undo and redo
arrives with car authoring — there is no chain yet for it to intercept.

---

## Testing

Vitest in a **jsdom** environment, with `tests/<module>.test.ts` mirroring `src/<module>.ts`. Run
`pnpm test` from the repo root: it covers `lib/*` as well, and the UI consumes those packages as
TypeScript source.

`tests/setup.ts` supplies what jsdom lacks globally — `ResizeObserver`, `Element.animate`,
`matchMedia`, `URL.createObjectURL` — and individual test files stub the rest (`PointerEvent`, SVG
geometry, `getUserMedia`).

Two patterns are in use:

**Pure template modules** — render into a detached element and assert with vitest's `expect`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, svg } from 'lit';
import { markerDefs, renderMarker } from '../src/marker.js';

it('renders a validation rect for a status', () => {
  const container = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  render(svg`${markerDefs()}${renderMarker({ id: '1', x: 0, y: 0, type: 'track', status: 'mismatch' }, 36)}`, container);
  expect(container.querySelector('.validation-rect')?.getAttribute('data-status')).toBe('mismatch');
});
```

Colors come from `markerStyles` via the `data-status` attribute — assert the attribute, not a
`stroke` attribute, which the markup does not carry.

**Components** — `@open-wc/testing` fixtures with its chai-style `expect`:

```typescript
import { fixture, html, expect } from '@open-wc/testing';
import '../src/rr-viewer.js';

it('renders <img> when src is set', async () => {
  const el = await fixture(html`<rr-viewer src="test.jpg"></rr-viewer>`);
  expect(el.shadowRoot!.querySelector('img')).to.exist;
});
```

**jsdom does not lay out or paint.** `getBoundingClientRect()` returns zeros and SVG geometry methods
are absent, so `rr-viewer`'s tests stub `createSVGPoint`/`getScreenCTM` per test. Assert DOM
structure, attributes, and emitted events — visual appearance cannot be verified here.

`capture.ts` and `rr-settings-dialog.ts` have no tests yet.
