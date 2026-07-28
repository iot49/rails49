# UI 

UI for coniguring track occupancy detection. Also provides a life view for real time observation of track occupancy.

## Naming Conventions

### Custom Element Prefix: `rr-`

All custom HTML elements in this project use the `rr-` prefix (**r**ail**r**oad).

**Why `rr-`:**
- Required by the HTML spec — custom elements must contain a hyphen to distinguish them from future standard elements
- `rr-` is project-specific and does not conflict with any common library prefix (`sl-` for Shoelace, `md-` for Material, etc.)
- Short, memorable, and self-documenting within the model railroad domain

**Rules:**
- All Lit `@customElement` registrations use `rr-<noun>` or `rr-<noun>-<qualifier>`
- Examples: `rr-app`, `rr-viewer`, `rr-editor-view`, `rr-toolbar`, `rr-stats-bar`
- Non-element modules (template functions, utilities, types) use plain `camelCase` filenames with no prefix: `marker.ts`, `classifier.ts`, `capture.ts`

### File Naming

| Kind | Convention | Example |
|---|---|---|
| Lit custom element | `rr-<name>.ts` | `rr-viewer.ts` |
| SVG template module | `<name>.ts` | `marker.ts` |
| Utility / service | `<name>.ts` | `classifier.ts`, `capture.ts` |
| Test file | `<name>.test.ts` in `tests/` | `tests/marker.test.ts` |

---

## Component Hierarchy

```
rr-app                          ← top-level shell, context providers
├── rr-header                   ← app bar: title, view toggle, settings gear
│   └── rr-settings-dialog      ← layout/classifier settings (sl-dialog)
├── rr-editor-view              ← editor mode (toolbar + thumbnails + viewer)
│   ├── rr-toolbar              ← vertical icon bar (label tools, file ops)
│   ├── rr-thumbnail-bar        ← horizontal image selector strip
│   └── rr-viewer               ← SHARED: media + SVG overlay + markers
│       └── marker template     ← lit template for single marker (constant screen size)
└── rr-live-view                ← live mode (camera + classification loop)
    ├── rr-stats-bar             ← FPS / classification stats overlay
    └── rr-viewer               ← SAME component, video source instead of img
        └── marker template
```

---

## Component Specifications

### `rr-app`

**Purpose**: Application shell. Provides shared context and routes between views.

| Property | Type | Description |
|---|---|---|
| `viewMode` | `'editor' \| 'live'` | Current view |

**Context Provided**:
- `r49Archive: R49Archive` — from `@occupancy/r49`
- `classifier: Classifier` — ONNX inference session

**Behavior**:
- Listens for `rr-view-toggle` event to switch views
- On load, initializes archive from default or opens empty state
- Replaces the manual cloning pattern in legacy `rr-main.ts`

---

### `rr-header`

**Purpose**: Fixed app bar at top.

| Slot | Content |
|---|---|
| `status` | Status bar text (set by active view) |

**Events Emitted**:
- `rr-view-toggle` — toggle editor/live
- Opens `rr-settings-dialog`

---

### `rr-settings-dialog`

**Purpose**: Layout and classifier configuration.

**Properties** (from context):
- `r49Archive`
- `classifier`

**Behavior**:
- Layout tab: name, scale, calibration dimensions
- Classifier tab: model selection (local upload or server catalog)
- Classifier config is NOT stored in the manifest (fix legacy design flaw). It's passed directly to the `Classifier` instance.

---

### `rr-toolbar`

**Purpose**: Vertical tool palette for the editor.

| Property | Type | Description |
|---|---|---|
| `activeTool` | `string \| null` | Currently selected tool ID |
| `disabled` | `boolean` | Disable all label tools (no image selected) |

**Events Emitted**:
- `rr-tool-select` with `{ tool: string }` — tool clicked
- `rr-file-new` — create a new empty archive
- `rr-file-open` — open file picker
- `rr-file-save` — save current archive

---

### `rr-thumbnail-bar`

**Purpose**: Horizontal strip of image thumbnails.

| Property | Type | Description |
|---|---|---|
| `images` | `string[]` | Array of image URLs (data URIs or blob URLs) |
| `selectedIndex` | `number` | Currently selected image |

**Events Emitted**:
- `rr-image-select` with `{ index: number }`
- `rr-image-delete` with `{ index: number }`
- `rr-image-add` with `{ source: 'camera' \| 'file' }`

---

### `rr-viewer` ⭐ (Key unified component)

**Purpose**: Display media (image or video) with an SVG marker overlay. Used identically by both editor and live views.

| Property | Type | Description |
|---|---|---|
| `src` | `string \| null` | Image URL (editor mode) |
| `stream` | `MediaStream \| null` | Video stream (live mode) |
| `markers` | `MarkerData[]` | Array of `{ id, x, y, type, status? }` |
| `calibration` | `CalibrationData \| null` | p0/p1 calibration points (editor only, image 0) |
| `interactive` | `boolean` | Enable click-to-place and drag (editor only) |
| `activeTool` | `string \| null` | Current tool (for click handling) |
| `resolution` | `{ width, height }` | Native media resolution (SVG viewBox) |

**Events Emitted** (only when `interactive`):
- `rr-marker-add` with `{ x, y, type }`
- `rr-marker-move` with `{ id, x, y }`
- `rr-marker-delete` with `{ id }`
- `rr-calibration-move` with `{ id, x, y }`

**Internal Structure**:
```typescript
import { renderMarker, markerDefs, markerStyles } from './marker.js';

static styles = [viewerStyles, markerStyles];
```
```html
<div class="viewport">
  <!-- One or the other, never both -->
  <img .src=${this.src} />
  <!-- or -->
  <video .srcObject=${this.stream} autoplay playsinline></video>

  <svg viewBox="0 0 ${this.resolution.width} ${this.resolution.height}" 
       preserveAspectRatio="xMidYMid meet">
    ${markerDefs()}
    ${this.markers.map(m => renderMarker(m, this.symbolSize))}
    <!-- calibration lines/handles -->
  </svg>
</div>
```

**Key design**: Both `<img>` and `<video>` use `object-fit: contain` which matches SVG's `preserveAspectRatio="xMidYMid meet"`. The SVG covers the full viewport and the viewBox maps 1:1 to pixel coordinates. This guarantees identical marker placement.

**Scaling**: Uses a `ResizeObserver` to compute `symbolSize = MARKER_SIZE_PX * (viewBoxWidth / elementWidth)`, keeping markers at a constant screen size regardless of zoom or window resize.

---

### `marker.ts` (Co-exported Module)

**Purpose**: Marker rendering for SVG contexts. Implemented as a co-exported module rather than a Custom Element because HTML Custom Elements break the SVG namespace when placed directly inside an `<svg>` tag. All three exports must be used together — the module boundary is the encapsulation mechanism.

**Exports**:

| Export | Type | Description |
|---|---|---|
| `renderMarker(marker, size)` | `(MarkerData, number) => SVGTemplateResult` | Renders a single marker as SVG nodes (`<use>` + optional validation rect) |
| `markerDefs()` | `() => SVGTemplateResult` | SVG `<defs>` block containing all symbol definitions (track, train, coupling, other) |
| `markerStyles` | `CSSResult` | CSS for validation rects, hover states, and drag handles — must be included in the host's `static styles` |

**`MarkerData` type**:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique marker identifier |
| `x` | `number` | Position in image pixel coordinates |
| `y` | `number` | Position in image pixel coordinates |
| `type` | `'track' \| 'train' \| 'coupling' \| 'other'` | Marker category |
| `status` | `'match' \| 'mismatch' \| 'pending' \| null` | Optional validation ring color |

---

### `rr-editor-view`

**Purpose**: Orchestrates the editor layout: toolbar + thumbnails + viewer.

**Behavior**:
- Manages `currentImageIndex` and `activeTool` state
- Wires events from child components to `R49Archive` mutations
- Passes the correct image URL and markers to `rr-viewer`
- Passes calibration data to `rr-viewer` when `activeTool` is 'calibrate' and the first image is selected.
- File open/save operations via `R49Archive.load()` / `.export()`

---

### `rr-live-view`

**Purpose**: Camera stream with real-time classification overlay.

**Behavior**:
- Starts camera via `getUserMedia`
- Runs classification loop on `requestAnimationFrame`
- Builds marker array from classification results
- Passes stream + markers to `rr-viewer` with `interactive=false`
- Renders `rr-stats-bar` for FPS/timing info

---

### `rr-stats-bar`

**Purpose**: Transparent overlay showing live classification stats.

| Property | Type | Description |
|---|---|---|
| `fps` | `number` | Frames per second |
| `count` | `number` | Markers classified per frame |
| `avgMs` | `number` | Average classification time |

---

## Data Flow

```
┌──────────────────────────────────────────────────┐
│ rr-app                                            │
│   provides: R49Archive (from @occupancy/r49)      │
│   provides: Classifier (ONNX session)             │
│                                                    │
│   ┌────────────────┐    ┌──────────────────────┐  │
│   │ rr-editor-view │    │ rr-live-view         │  │
│   │  reads:        │    │  reads:              │  │
│   │   archive      │    │   archive.manifest   │  │
│   │  mutates:      │    │   classifier         │  │
│   │   archive      │    │  mutates: nothing    │  │
│   └────────────────┘    └──────────────────────┘  │
│         │                      │                   │
│         └──────┬───────────────┘                   │
│                ▼                                   │
│          rr-viewer                                 │
│       (shared component)                           │
└──────────────────────────────────────────────────┘
```

**Key change from legacy**: `R49Archive` from `@occupancy/r49` replaces both `R49File` and `Manifest`. Lit context provides the archive directly. Mutations call archive methods → Lit's reactive context handles propagation → no manual `EventTarget` cloning.

---

## Migration from Legacy

| Legacy File | New Location | Notes |
|---|---|---|
| `rr-main.ts` | `rr-app.ts` | Replace manual event cloning with Lit context |
| `rr-page.ts` | `rr-header.ts` | Extract header only, remove slot-based routing |
| `rr-layout-editor.ts` | `rr-editor-view.ts` | Split into toolbar + thumbnails + viewer |
| `rr-live-view.ts` | `rr-live-view.ts` | Keep camera/loop logic, delegate rendering to rr-viewer |
| `rr-label.ts` | `rr-viewer.ts` + `marker.ts` | Split 449-line monolith |
| `rr-settings.ts` | `rr-settings-dialog.ts` | Decouple classifier config from manifest |
| `app/r49file.ts` | Use `@occupancy/r49` | Delete |
| `app/manifest.ts` | Use `@occupancy/r49` schema types | Delete EventTarget wrapper |
| `app/manifest.schema.ts` | `@occupancy/r49` | Already done (v3 schema) |
| `app/classify.ts` + `app/classifier.ts` | `app/classifier.ts` | Merge into single clean implementation |
| `app/capture.ts` | `app/capture.ts` | Keep as-is (clean utility) |
| `app/perspective_transform.ts` | Delete | No longer needed without OpenCV |
| `marker-defs.ts` | `marker.ts` | Inline into marker template module |

---

## Testing Strategy

### Stack

- **Vitest** — already in the workspace for `@occupancy/r49`
- **`@open-wc/testing`** — fixtures for rendering Lit components in a real DOM
- **`@open-wc/testing-helpers`** — `fixture()`, `html`, `oneEvent` utilities

### Regression Command

After every step, run:

```bash
pnpm test          # runs vitest across all workspaces
```

This catches regressions in **both** `@occupancy/r49` (the library) and `ui` (the app) in one command.

### Test Pattern

Every component test follows the same pattern — render in a fixture, assert DOM state and events:

```typescript
import { fixture, html, expect } from '@open-wc/testing';
import { renderMarker, markerDefs } from '../src/marker.js';

describe('marker template', () => {
  it('renders track icon at correct position', async () => {
    const m = { id: '1', x: 100, y: 200, type: 'track' };
    const el = await fixture(html`
      <svg>${markerDefs()}${renderMarker(m, 36)}</svg>
    `);
    const use = el.querySelector('use');
    expect(use?.getAttribute('href')).to.equal('#track');
  });

  it('shows red ring on mismatch', async () => {
    const m = { id: '1', x: 0, y: 0, type: 'track', status: 'mismatch' };
    const el = await fixture(html`
      <svg>${markerDefs()}${renderMarker(m, 36)}</svg>
    `);
    const rect = el.querySelector('.validation-rect');
    expect(rect?.getAttribute('stroke')).to.equal('red');
  });
});
```

---

## Implementation Steps

Each step adds a component **and** its tests. Running `pnpm test` at any point validates everything built so far.

### Step 1: Scaffold + `marker.ts` ✅

Initialize `ui/` as a Vite + Lit + Shoelace project in the pnpm workspace. Implement the `marker.ts` co-exported module — three pure functions/values with no state or events.

**Deliverables**: `renderMarker()`, `markerDefs()`, `markerStyles`

**Tests:**
- `markerDefs()` produces `<defs>` with symbols for each type (`track`, `train`, `coupling`, `other`)
- `renderMarker()` renders correct SVG symbol `<use>` for each type
- Applies correct position via `x`/`y` from `MarkerData`
- Renders validation ring with correct color for each `status`
- Symbol size matches `size` argument
- `markerStyles` is a non-empty `CSSResult`

### Step 2: `rr-viewer` (image mode, read-only) ✅

Core unified component. Start with static image + markers, no interactivity.

**Tests:**
- Renders `<img>` when `src` is set, no `<video>`
- SVG `viewBox` matches `resolution` property
- Markers render at correct positions
- `ResizeObserver` updates symbol size (mock `offsetWidth`)
- Calibration lines render when `calibration` is provided

### Step 3: `rr-viewer` (interactivity) ✅

Add click-to-place and drag behavior.

**Tests:**
- Click emits `rr-marker-add` with SVG-space coordinates when `interactive=true`
- Click does nothing when `interactive=false`
- Drag emits `rr-marker-move` with correct ID
- Click on marker with delete tool emits `rr-marker-delete`

### Step 4: `rr-toolbar` ✅

Stateless event emitter — vertical tool palette for the editor.

**Tests:**
- Clicking each tool emits `rr-tool-select` with correct tool ID
- Active tool gets highlighted CSS class
- Tools are disabled when `disabled=true`
- File buttons emit `rr-file-open` / `rr-file-save`

### Step 5: `rr-thumbnail-bar` ✅

Stateless event emitter — horizontal image selector strip.

**Tests:**
- Renders correct number of thumbnails from `images` array
- Selected thumbnail gets `.active` class
- Click emits `rr-image-select` with index
- Delete button emits `rr-image-delete` with index
- Add buttons emit `rr-image-add` with source type

### Step 6: `rr-header` + `rr-settings-dialog` ✅

Shell chrome and configuration forms.

**Tests:**
- Header renders status slot content
- Toggle button emits `rr-view-toggle`
- Settings dialog opens on gear click
- Layout fields update values and emit changes
- Scale dropdown populates with all scale options

### Step 7: `rr-editor-view` ✅

Integration: wires toolbar + thumbnails + viewer to `R49Archive`.

**Tests:**
- Selecting an image updates viewer `src`
- Selecting a tool updates viewer `activeTool`
- `rr-marker-add` event creates marker in archive
- `rr-marker-delete` event removes marker from archive
- File open loads archive and populates thumbnails
- **Regression**: all Step 2–5 tests still pass

### Step 8: `rr-app` ✅

Top-level shell with context providers.

**Tests:**
- Provides `R49Archive` context to children
- View toggle switches between editor and live views
- Context updates propagate to nested components

### Step 9: `rr-viewer` (video mode) + `rr-live-view` ✅

Camera stream and real-time classification loop.

**Tests:**
- Viewer renders `<video>` when `stream` is set, no `<img>`
- `rr-stats-bar` renders FPS/count/time values
- Classification loop calls classifier with correct patches (mock `getUserMedia`)
- **Regression**: all previous tests still pass

### Step 10: New Archive Action ✅

Add the ability to create a new `.r49` file from scratch.

**Deliverables:**
- Update `rr-toolbar` with a "New file" button that emits `rr-file-new`.
- Update `rr-app` to handle `rr-file-new` by initializing an empty `R49Archive`.
- Set default manifest properties (e.g., version 3, layout name 'New Layout', scale 'N', empty images array).

**Tests:**
- Toolbar "New file" button emits `rr-file-new`
- Application handles the event and initializes a blank layout context.

### Step 11: Calibration Validation on Save

Prevent the user from saving an `.r49` archive if the layout calibration is incomplete.

**Deliverables:**
- Update the save logic in `rr-app` or `rr-editor-view` to validate the manifest's layout calibration before exporting.
- Calibration is strictly required. Show a clear error to the user (e.g., via alert) if `calibration` is undefined, or if `p0`, `p1`, or `size_mm` are missing or invalid.
- **Definition of Invalid:**
  - `size_mm` is missing, less than or equal to 0, or NaN.
  - `p0` or `p1` are missing or their x/y coordinates are NaN.
  - `p0` and `p1` are identical (distance between them is 0).

**Tests:**
- Attempting to save with an undefined or missing `calibration` object shows an error and aborts the save.
- Attempting to save with missing or invalid `p0` or `p1` (e.g. identical points) shows an error and aborts the save.
- Attempting to save with an invalid `size_mm` (e.g. `<= 0`) shows an error and aborts the save.
- Valid, user-provided calibration allows the `R49Archive.export()` process to proceed.
