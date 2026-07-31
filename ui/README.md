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
├── rr-editor-view              ← editor mode; images, DPT readout, calibration points, sensors
│   ├── rr-toolbar              ← vertical icon bar (file ops + undo/redo)
│   ├── rr-tool-palette         ← active tool, and the calibration gate on the labeling ones
│   ├── rr-viewer               ← SHARED: media + SVG overlay; reports pointer gestures
│   │   ├── marker.ts           ← module, not an element
│   │   ├── calibrationMarker.ts ← module: the labelled crosshair
│   │   └── sensorMarker.ts     ← module: the labelled diamond
│   ├── rr-thumbnail-bar        ← horizontal image selector strip
│   ├── rr-calibration-dialog   ← asks for a point's x/y/z in mm (sl-dialog)
│   ├── rr-sensor-dialog        ← asks for a sensor's optional name (sl-dialog)
│   └── rr-context-menu         ← right-click verbs on one object (sl-menu)
└── rr-live-view                ← live mode; owns the classifier
    ├── rr-stats-bar            ← FPS / marker-count overlay
    └── rr-viewer               ← SAME component, video source instead of img
        └── marker.ts
```

> **The editor authors calibration points and sensors.** v3's point-marker
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
>
> Still absent, each with its own ticket: car authoring (chain-clicked two-point
> spans, [#32]) and the completeness affordance ([#36]). They are specified in
> `../SPEC.md` § Labeling Workflow. Because no chain can be live, a right-click
> is still always the idle branch, and the `car` tool selects but authors
> nothing.
>
> [#19]: https://github.com/iot49/rails49/issues/19
> [#27]: https://github.com/iot49/rails49/issues/27
> [#28]: https://github.com/iot49/rails49/issues/28
> [#29]: https://github.com/iot49/rails49/issues/29
> [#30]: https://github.com/iot49/rails49/issues/30
> [#31]: https://github.com/iot49/rails49/issues/31
> [#32]: https://github.com/iot49/rails49/issues/32
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
  the click that is waiting on a coordinate or a name, and what the context menu is open on. It
  mutates the archive through image add/remove/reorder, through calibration-point placement, edits
  and deletion, and through sensor placement, naming, drag and deletion — each wrapped in
  `history.record` (or in one `beginGesture` per drag).
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

The `car` tool selects but authors nothing: car authoring is [#32]. The palette is what that ticket
plugs into.

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

**Scaling.** A `ResizeObserver` recomputes
`symbolSize = MARKER_SIZE_PX * (resolution.width / svgRect.width)`, keeping markers a constant
*screen* size at any zoom or window size.

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
| `carWidthPx(dpt)` | Car width in image pixels: `dpt × STANDARD_WIDTH / STANDARD_GAUGE` |
| `carCorners(p0, p1, dpt)` | The four corners of the oriented rectangle, in polygon order from the `p0` side |
| `hitTest(scene, at, tolerance)` | The `HitTarget` under an image-pixel coordinate, or `null` |
| `HitScene` | `{ cars, sensors, calibrationPoints }` — everything grabbable for one image of one layout |
| `HitTarget` | `car-endpoint` / `coupler` (both carrying `ends`), `sensor` (`id`), `calibration` (`index`) |
| `HitTolerance` | `{ screenPx, imagePxPerScreenPx }` |
| `dragHandles(hit, scene)` | The points a grab moves — **a list**, one per object, and two or more for a coupler |
| `DragHandle` | `{ ref, from }`: what it addresses, and where it sat at pointer-down |
| `HandleRef` | `calibration` (`index`), `car-end` (`id`, `end`), `sensor` (`id`) — never an object reference |
| `dragTo(handle, delta)` | Where that handle lands, in whole image pixels |
| `DEFAULT_GRAB_RADIUS_SCREEN_PX` | The grab radius every tool uses, in screen pixels — one number, because it describes the pointing device |
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

### `sensorMarker.ts`

The sensor's own SVG, with the same shape and the same rules as `calibrationMarker.ts`. **The exports
must be used together** — styles in the host's `static styles`, the renderer once per sensor.

| Export | Type | Description |
|---|---|---|
| `renderSensor(sensor, size, frame)` | `(Sensor, number, FrameSize) => SVGTemplateResult` | A diamond centered on the sensor, a filled core at the exact pixel, and a `text` label. `size` is `rr-viewer`'s `symbolSize`, `frame` its `resolution` |
| `sensorLabelText(sensor)` | `(Sensor) => string` | The sensor's `name`, or its `id` when it has none |
| `sensorMarkerStyles` | `CSSResult` | Diamond and label colors, the translucent fill, non-scaling strokes |

**Amber diamond against the crosshair's cyan arms**, and the difference is shape as much as colour: a
sensor and a calibration point are different objects with different tools, and `../SPEC.md`
§ Reference points requires them to be unmistakable. The symbol also *closes* around its pixel rather
than extending arms, because a sensor is a single query point and nothing about it implies an extent.

**An unnamed sensor is labelled with its `id`.** Names are optional, free text, not unique, and never
auto-generated (`../SPEC.md` § Occupancy Output): an invented "Sensor 3" is indistinguishable from a
name a human chose and stops matching as sensors come and go. A blank name is treated as no name.

`frame` is the label's business only, exactly as for the crosshair, and through the same
`placeLabel`.

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
| `ContextMenuItem` | `{ id, label }` | `id` is reported on selection and never shown; `label` is what the user reads |
| `ScreenPoint` | `{ x, y }` | Named apart from `Point` on purpose — every other editor position is in **image** pixels; a menu is placed on the glass |

**Emits:** `rr-context-menu-select` with `{ id }`. Dismissing emits nothing.

**It knows nothing about what the object is.** The editor hit-tests, names the verbs, and interprets
the selection; this element renders rows and reports which one was chosen. That is what lets cars and
sensors plug into the same menu as they arrive, along with the reclassify submenu the spec puts here.

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

Orchestrates the editor: images, a DPT readout, the active tool, calibration and sensor authoring,
and the right-click menu.

| Property | Type | Description |
|---|---|---|
| `archive` | `R49Archive \| null` | |
| `history` | `EditHistory \| null` | The undo stack; every mutation below runs through it |
| `canUndo` / `canRedo` | `boolean` | Passed through to `rr-toolbar` |
| `undoLabel` / `redoLabel` | `string \| null` | Passed through to `rr-toolbar` |

**Emits:** `rr-history-change` after recording an edit.

**Method:** `syncFromArchive(revealFilename?)` — rebuilds the blob URLs and optionally selects an
image. Called by `rr-app` after undo or redo, which is how an entry scoped to another image brings
that image into view before the change lands.

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
  * The hit-test scene contains calibration points and sensors — the two objects this editor can
    create. Cars join it with the tool that authors them ([#32]).
* **Dragging** ([#30]). A press on a calibration point followed by motion past `CLICK_SLOP_SCREEN_PX`
  moves it, and the DPT readout follows live, mid-gesture. The history entry is opened at
  pointer-down and committed at pointer-up, **never per motion event**, so a drag across the image is
  one Cmd+Z and not two hundred; a drag returned to its origin records **nothing**, suppressed by
  value comparison in `EditHistory` rather than by trusting that the user meant it.
  * The gesture moves a **list** of handles from `dragHandles`, which is what lets one entry cover
    more than one object — the coupler case a car drag will need. Calibration and sensor handles are
    written today; a car end joins them with [#32]. Both live in `layout`, so one entry covers a
    gesture whatever it grabbed, and only the entry's *label* differs.
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
  a `switch` over an `EditorMode` union whose only member today is `idle`, because right-click is
  state-dependent by design (`../SPEC.md` § Right-click is state-dependent): idle opens the menu,
  chaining a train will end the chain instead. Written as a branch so that is a case to add rather
  than a rewrite.
  * The **idle** branch hit-tests at `DEFAULT_GRAB_RADIUS_SCREEN_PX` and opens `rr-context-menu` at
    the cursor: **delete** for a calibration point, **name and delete** for a sensor. Empty image
    opens nothing, and neither does an object with no verbs — a list of disabled rows is a worse
    answer than the absence of one. Cars get their rows from the same switch when the tool that
    creates them exists.
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
  component holds the tool and dispatches a click on it. A click on **empty image** runs the tool —
  calibration opens the dialog, sensor places a point, car does nothing until [#32]. A click **on an
  object** edits that object *whatever the tool is*, because the thing under the cursor is less
  ambiguous than the mode: a coordinate for a calibration point, a name for a sensor.
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
* **It authors no cars and loads no classifier.** Car authoring is [#32]; marker CRUD and the
  per-marker classification display went with the v4 reduction. See the note at the top of this file.

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
