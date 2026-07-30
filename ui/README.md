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
│   └── rr-settings-dialog      ← layout settings (sl-dialog)
├── rr-editor-view              ← editor mode; owns its own classifier
│   ├── rr-toolbar              ← vertical icon bar (label tools, file ops)
│   ├── rr-viewer               ← SHARED: media + SVG overlay + markers
│   │   └── marker.ts           ← module, not an element
│   └── rr-thumbnail-bar        ← horizontal image selector strip
└── rr-live-view                ← live mode; owns its own classifier
    ├── rr-stats-bar            ← FPS / marker-count overlay
    └── rr-viewer               ← SAME component, video source instead of img
        └── marker.ts
```

## State and data flow

There is no Lit context and no shared store. `rr-app` holds the single `R49Archive` and passes it
down as the `.archive` property; children report upward with bubbling `rr-*` custom events:

```
        .archive ↓                    ↑ rr-* events (bubbles: true, composed: true)
rr-app ─────────── rr-editor-view ─────────── rr-viewer / rr-toolbar / rr-thumbnail-bar
   │
   └─────────────── rr-live-view ───────────── rr-viewer / rr-stats-bar
```

* **`rr-app` owns:** the archive, the view mode, the status string, and file new/open/save.
* **`rr-editor-view` owns:** the current image index, the active tool, blob URLs for the images, and
  per-marker classification results. It mutates the archive in place.
* **`rr-live-view` owns:** the camera stream and the classification loop. It never mutates the archive.
* **The classifier is not shared.** `rr-editor-view` and `rr-live-view` each construct their own
  `BrowserClassifier` and load the model independently.

Lit does not observe mutations *inside* `R49Archive`, so handlers that edit the manifest in place
call `this.requestUpdate()` explicitly.

---

## Component reference

### `rr-app`

Application shell. Owns the archive and routes between the two views.

**Internal state** (no public properties): `_archive`, `_viewMode` (`'editor' | 'live'`), `_status`.
Starts with no archive loaded.

**Handles:** `rr-view-toggle`, `rr-layout-change`, `rr-file-new`, `rr-file-open`, `rr-file-save`.

* `rr-file-new` builds an empty v3 manifest — layout `'New Layout'`, scale `N`, resolution 1920×1080.
* `rr-file-open` reads a `.r49` through a file input and `R49Archive.load()`.
* `rr-file-save` **validates calibration first** and aborts with a toast if it fails: `calibration`
  must exist, `p0`/`p1` must be present, non-NaN, and distinct, and `size_mm` must be a positive
  number. Only then does it `export()` and download.

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

Layout settings, in an `sl-dialog` with a single "Layout" tab: name, scale (from `VALID_SCALES`), and
reference size in mm.

| Property | Type | Description |
|---|---|---|
| `layout` | `{ name?, scale, calibration? }` | Current layout; defaults to scale `N` |

**Methods:** `show()`, `hide()`.

**Emits:** `rr-layout-change` with `{ layout: Partial<Layout> }` — one changed field per event.
Editing the reference size synthesizes a default `p0`/`p1` if the layout has no calibration yet.

Classifier selection is **not implemented**: there is no classifier tab, and the
`rr-classifier-change` event named in the source JSDoc is never fired. Classifier config comes from
`models/config.json` at runtime and is deliberately not stored in the manifest.

---

### `rr-toolbar`

Vertical tool palette for the editor.

| Property | Type | Description |
|---|---|---|
| `activeTool` | `string \| null` | Highlights the matching button |
| `disabled` | `boolean` | Disables the label tools; currently never set by `rr-editor-view` |

**Tool IDs**, which `rr-editor-view` and `rr-viewer` both switch on: `track`, `train`, `coupling`,
`other`, `delete`, `calibrate`. The first four double as marker types.

**Emits:** `rr-tool-select` `{ tool: string }`, `rr-file-new`, `rr-file-open`, `rr-file-save`.

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

Displays media — image or video — under an SVG marker overlay.

| Property | Type | Description |
|---|---|---|
| `src` | `string \| null` | Image URL (editor mode) |
| `stream` | `MediaStream \| null` | Video stream (live mode) |
| `markers` | `MarkerData[]` | Markers to draw |
| `calibration` | `CalibrationData \| null` | `{ p0, p1, size_mm }`; draws the dashed line and two drag handles |
| `interactive` | `boolean` | Enables click-to-place, drag, and delete |
| `activeTool` | `string \| null` | Decides what a click means |
| `resolution` | `{ width, height }` | Native media resolution → the SVG viewBox |

**Emits** (only when `interactive`): `rr-marker-add` `{ x, y, type }`, `rr-marker-move` `{ id, x, y }`,
`rr-marker-delete` `{ id }`, `rr-calibration-move` `{ id: 'p0' | 'p1', x, y }`.

Clicks add a marker only on empty background, and only when `activeTool` is a marker type — `delete`
and `calibrate` are excluded. With `delete` active, clicking a marker removes it.

**Methods:** `getVideoElement()`, `getImageElement()` — `rr-live-view` uses these to feed the
classifier the live frame source.

**Why one component for both modes.** `<img>` and `<video>` both use `object-fit: contain`, matched
to the SVG's `preserveAspectRatio="xMidYMid meet"`, and the SVG overlays the full viewport. The
viewBox therefore maps 1:1 onto image pixel coordinates, so a marker lands in the same place in
either mode. Changing one half of that pair silently misplaces every marker.

**Scaling.** A `ResizeObserver` recomputes
`symbolSize = MARKER_SIZE_PX * (resolution.width / svgRect.width)`, keeping markers a constant
*screen* size at any zoom or window size. Pointer positions convert through `screenToSvg()`
(`createSVGPoint` + inverse `getScreenCTM`).

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

Symbols defined: `track`, `train`, `coupling`, `other`, and `drag-handle` (used for calibration
points). Each is a 24×24 viewBox centered on (0,0), so `<use transform="translate(x,y)">` places it
centered without manual offsets. An unrecognized `type` falls back to `other`.

**`MarkerData`**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique marker id |
| `x`, `y` | `number` | Image pixel coordinates |
| `type` | `'track' \| 'train' \| 'coupling' \| 'other'` | Marker category |
| `status?` | `'match' \| 'mismatch' \| 'pending' \| null` | Validation ring: green / red / orange. Omit or `null` for no ring |
| `detectedLabels?` | `string[]` | What the classifier returned; shown as the `<title>` tooltip |

---

### `rr-editor-view`

Orchestrates the editor and mutates the archive.

| Property | Type |
|---|---|
| `archive` | `R49Archive \| null` |

* Creates blob URLs for every image in the manifest, revoking the previous set on reload.
* Marker CRUD writes directly into `manifest.images[i].labels`, keyed by a `make_id()` id.
* Selecting the `calibrate` tool seeds a default `p0`/`p1`/`size_mm` if the layout has none, and
  passes `calibration` to `rr-viewer` for as long as that tool stays active.
* Image add (camera or file), delete, and reorder go through the corresponding `R49Archive` methods.
* **Classification.** On archive load, image change, or any marker edit, it classifies every marker
  on the current image and sets each marker's `status` to `match` or `mismatch`. If `getDPT()`
  returns null the layout is uncalibrated: it shows a banner and marks everything `pending`.

---

### `rr-live-view`

Camera stream with a real-time classification overlay.

| Property | Type |
|---|---|
| `archive` | `R49Archive \| null` |

* Opens the camera via `getCameraStream()` and runs a `requestAnimationFrame` loop, skipping frames
  until the video reports usable dimensions.
* **Markers come from `manifest.images[0]`** — the first image acts as the template for where to
  classify. Coordinates are scaled from the manifest resolution to the live frame's natural size.
* Each marker's icon is the highest-priority returned label, ordered train > coupling > track.
* Requires calibration for the same reason as the editor; shows a banner when `getDPT()` is null.
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
