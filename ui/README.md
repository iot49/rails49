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
├── rr-editor-view              ← editor mode; images + DPT readout, authors nothing
│   ├── rr-toolbar              ← vertical icon bar (file ops + undo/redo)
│   ├── rr-viewer               ← SHARED: media + read-only SVG overlay
│   │   └── marker.ts           ← module, not an element
│   └── rr-thumbnail-bar        ← horizontal image selector strip
└── rr-live-view                ← live mode; owns the classifier
    ├── rr-stats-bar            ← FPS / marker-count overlay
    └── rr-viewer               ← SAME component, video source instead of img
        └── marker.ts
```

> **The editor authors no geometry.** Point-marker placement and two-point
> calibration dragging were removed in the v4 reduction ([#19]); v4 stores
> neither. Car authoring (chain-clicked two-point spans), sensor placement, and
> the calibration-point tool are specified in `../SPEC.md` § Labeling Workflow
> and are a separate effort. What the editor does today is open an archive,
> manage its images, edit layout metadata, and report DPT.
>
> [#19]: https://github.com/iot49/rails49/issues/19

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
* **`rr-editor-view` owns:** the current image index and blob URLs for the images. It mutates the
  archive only through image add/remove/reorder — each wrapped in `history.record`.
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
`rr-tool-select` event they fired are gone, along with `activeTool` and `disabled`. Car, sensor and
calibration-point tools return with the editor spec.

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

Displays media — image or video — under a **read-only** SVG marker overlay.

| Property | Type | Description |
|---|---|---|
| `src` | `string \| null` | Image URL (editor mode) |
| `stream` | `MediaStream \| null` | Video stream (live mode) |
| `markers` | `MarkerData[]` | Markers to draw |
| `resolution` | `{ width, height }` | Native media resolution → the SVG viewBox |

**Emits:** nothing.

**It authors nothing.** `interactive`, `activeTool`, `calibration`, the pointer handlers, and the
four events they fired (`rr-marker-add`, `rr-marker-move`, `rr-marker-delete`,
`rr-calibration-move`) were all removed in the v4 reduction — v4 has neither point markers nor a
draggable `{p0, p1}` pair. The editor spec's tools will reintroduce a `screenToSvg()` of their own.

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

### `rr-editor-view`

Orchestrates the editor: images and a DPT readout.

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
  each wrapped in `history.record`. These are its **only** mutations of the archive. Deletion passes
  `retain` so the image's bytes survive for undo.
* **DPT readout** (`.dpt-bar`). Shows `getDPT()` to one decimal, or "Not calibrated" with a warning
  style when it returns `null` — a real v4 state, reported rather than blocked on.
* **It authors no geometry and loads no classifier.** Marker CRUD, the calibration seeding, and the
  per-marker classification display all went with the v4 reduction. See the note at the top of this
  file.

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
