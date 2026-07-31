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
├── rr-editor-view              ← editor mode; images, DPT readout, calibration points
│   ├── rr-toolbar              ← vertical icon bar (file ops + undo/redo)
│   ├── rr-viewer               ← SHARED: media + SVG overlay; reports pointer gestures
│   │   ├── marker.ts           ← module, not an element
│   │   └── calibrationMarker.ts ← module: the labelled crosshair
│   ├── rr-thumbnail-bar        ← horizontal image selector strip
│   └── rr-calibration-dialog   ← asks for a point's x/y/z in mm (sl-dialog)
└── rr-live-view                ← live mode; owns the classifier
    ├── rr-stats-bar            ← FPS / marker-count overlay
    └── rr-viewer               ← SAME component, video source instead of img
        └── marker.ts
```

> **The editor authors calibration points, and nothing else yet.** v3's
> point-marker placement and two-point calibration dragging were removed in the
> v4 reduction ([#19]); v4 stores neither. [#27] added the provisioning —
> `rr-viewer` reporting pointer gestures in image pixels, and `geometry.ts`
> holding the car-width, rectangle and hit-testing arithmetic — and [#28] gave
> it its first consumer: click a pixel, type its world coordinate, and the point
> is written as one `layout` history entry.
>
> Still absent, each with its own ticket: the tool palette and the calibration
> gate on the labeling tools ([#31]), the right-click context menu and delete
> ([#29]), dragging ([#30]), car authoring (chain-clicked two-point spans),
> sensor placement, and the completeness affordance. They are specified in
> `../SPEC.md` § Labeling Workflow. Because the palette does not exist, a click
> in the viewer unconditionally means *calibrate*.
>
> [#19]: https://github.com/iot49/rails49/issues/19
> [#27]: https://github.com/iot49/rails49/issues/27
> [#28]: https://github.com/iot49/rails49/issues/28
> [#29]: https://github.com/iot49/rails49/issues/29
> [#30]: https://github.com/iot49/rails49/issues/30
> [#31]: https://github.com/iot49/rails49/issues/31

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
* **`rr-editor-view` owns:** the current image index, blob URLs for the images, and the click that is
  waiting on a coordinate. It mutates the archive through image add/remove/reorder and through
  calibration-point placement and edits — each wrapped in `history.record`.
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
hijack Cmd+Z mid-typing.

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
does not come back here until [#31]**, which adds it together with the tools it would choose between
and the calibration gate that disables them. Calibration authoring needs no palette entry in the
meantime: it is the only tool, so every click in the viewer means calibrate.

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
whether the native menu is suppressed depends on editor state.

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
| `DEFAULT_GRAB_RADIUS_SCREEN_PX` | The grab radius every tool uses, in screen pixels — one number, because it describes the pointing device |
| `CLICK_SLOP_SCREEN_PX` | How far a pointer may travel between press and release and still be a click. Smaller than the grab radius: this is tremor, not aim |
| `isClick(from, to, tolerance)` | Whether a finished gesture was a click rather than a drag |

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

---

### `calibrationMarker.ts`

The calibration point's own SVG, as a module for the same reason `marker.ts` is one. **Both exports
must be used together** — styles in the host's `static styles`, the renderer once per point.

| Export | Type | Description |
|---|---|---|
| `renderCalibrationPoint(point, index, size)` | `(CalibrationPoint, number, number) => SVGTemplateResult` | A crosshair centered on `point.px`, a small circle at the exact pixel, and a `text` label carrying the world coordinate. `size` is in image pixels — `rr-viewer`'s `symbolSize`, so the crosshair is constant on screen |
| `calibrationMarkerStyles` | `CSSResult` | Crosshair and label colors, non-scaling strokes, and the label's own outline |

There are no `<defs>` and so no third export: a crosshair is two lines, and nothing is reused.

A calibration point is drawn **unlike anything else in the editor** by requirement (`../SPEC.md`
§ Reference points) — it must not be confusable with the sensor symbol that arrives with [#31]. The
crosshair also names the exact pixel, which a boxed icon does not. The label rounds to one decimal:
coordinates are typed by hand today, but a dragged point will not be, and float noise in a label
reads as a bug in the editor.

Points carry **no `id`** — nothing references one individually — so `index` (position in
`layout.calibration.points`) is the only handle a gesture has, and it is rendered as
`data-calibration-index`.

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

### `rr-editor-view`

Orchestrates the editor: images, a DPT readout, and calibration authoring.

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
  * **A drag does nothing**, and `rr-pointer-cancel` abandons the gesture. Without the slop test
    every swipe over the image would place a point, and the labeling device is a phone. The
    **press** position is what gets used — where the user aimed, and where a drag would grab. This
    is the seam dragging ([#30]) takes over, and where the palette ([#31]) will dispatch on the
    active tool.
  * The hit-test scene contains only calibration points, because they are the only object this
    editor can create. Cars and sensors join it with the tools that author them.
  * An edit remembers the **pixel** as well as the index. Points carry no `id`, so if an undo lands
    while the dialog is open and slides that index onto a different point, the commit is dropped
    rather than applied to whatever now sits there.
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
* **It authors no other geometry and loads no classifier.** Marker CRUD and the per-marker
  classification display went with the v4 reduction. See the note at the top of this file.

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
| `EditHistory` | `attach`, `record`, `undo`, `redo`, `markSaved`; `canUndo`/`canRedo`/`undoLabel`/`redoLabel`/`isDirty`/`size`/`bytes` |
| `HistoryTarget` | `{ kind: 'layout' }`, `{ kind: 'image', filename }`, or `{ kind: 'images' }` |
| `HistoryEntry` | What `undo`/`redo` return, so the caller can reveal what changed |
| `DEFAULT_HISTORY_BUDGET_BYTES` | 256 MB. A UI constant, **not** a `config.yaml` value — nothing outside `ui/` can read it |

Entries are **scoped snapshots** — `before`/`after` clones of the one subtree touched — so undo and
redo are one operation with the fields swapped, and there is no per-command inverse to author
wrongly. Retention is bounded by bytes rather than entry count, because entries range from a
kilobyte to a whole JPEG; eviction truncates the oldest end and never punches a hole.

What is built and what is not: this covers layout metadata and image add/remove/reorder, which are
the only manifest mutations the reduced editor has. The per-gesture drag commits and the chain
interception described in `../SPEC.md` § Undo and redo arrive with car authoring — there is nothing
yet for them to attach to.

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
