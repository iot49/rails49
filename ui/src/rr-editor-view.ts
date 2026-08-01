import { LitElement, html, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { R49Archive, getDPT, getDPTResidual } from '@occupancy/r49';
import type {
  CalibrationPoint,
  CarLabel,
  Image,
  ManifestData,
  Point,
  Sensor,
} from '@occupancy/r49';
import { MIN_DPT } from '@occupancy/config';
import { make_id } from '@occupancy/uid';
import { captureFromCamera } from './capture.js';
import {
  dragHandles,
  dragTo,
  hitTest,
  isClick,
  CLICK_SLOP_SCREEN_PX,
  DEFAULT_GRAB_RADIUS_SCREEN_PX,
} from './geometry.js';
import type { DragHandle, HitScene, HitTarget, HitTolerance } from './geometry.js';
import type { EditHistory, HistoryGesture, HistoryTarget } from './history.js';
import type { ViewerContextMenuDetail, ViewerPointerDetail } from './rr-viewer.js';
import type { CalibrationCommitDetail, RRCalibrationDialog } from './rr-calibration-dialog.js';
import type { SensorNameCommitDetail, RRSensorDialog } from './rr-sensor-dialog.js';
import type { EditorTool, ToolSelectDetail } from './rr-tool-palette.js';
import type {
  ContextMenuItem,
  ContextMenuSelectDetail,
  RRContextMenu,
} from './rr-context-menu.js';

import './rr-viewer.js';
import './rr-toolbar.js';
import './rr-tool-palette.js';
import './rr-thumbnail-bar.js';
import './rr-calibration-dialog.js';
import './rr-sensor-dialog.js';
import './rr-context-menu.js';

/**
 * Node id for the snowflakes this editor mints, as `make_id` takes one.
 *
 * The node id only separates concurrent generators; it carries no meaning
 * downstream. Images already use 2 and 3, so sensors take their own rather than
 * sharing a stream with them.
 */
const SENSOR_NODE_ID = 4;

/**
 * Node id for car label snowflakes.
 *
 * Its own stream rather than the sensors': label ids and sensor ids are
 * separate namespaces that are never compared (`manifest.schema.ts`), and
 * generating them from one node makes them look related when they are not.
 */
const CAR_NODE_ID = 5;

/**
 * The class every new car is created with.
 *
 * The root of the dotted taxonomy, and the only class this editor writes:
 * refinement is an occasional act through the context menu (#35), not a mode,
 * so a car starts at the root and is reclassified downwards. The root is
 * **required in the stored class** — a label maps to the longest entry of
 * `detector.classes` that is a segment-prefix of its class, and an unrooted one
 * would match nothing and be dropped from the export.
 */
const NEW_CAR_CLASS = 'stock';

/**
 * The gesture a click is waiting on a coordinate for.
 *
 * A calibration point is authored in two steps — the click gives the pixel, the
 * dialog gives the millimetres — and nothing is written until the second one
 * lands, so a dismissed dialog leaves the manifest and the undo stack untouched.
 * An edit carries the index rather than the point, because points have no `id`
 * and applying a history snapshot replaces them wholesale.
 */
type PendingCalibration =
  /** A new point, at the pixel that was clicked. */
  | { readonly kind: 'place'; readonly px: Point }
  /**
   * An existing point. `px` is carried alongside the index so the commit can
   * check it is still the same point: an undo while the dialog is open can
   * remove or replace another point and slide this index onto a different one.
   */
  | { readonly kind: 'edit'; readonly index: number; readonly px: Point };

/**
 * What the editor is in the middle of — the state the gestures that mean two
 * things are dispatched on.
 *
 * Right-click is state-dependent by design (`SPEC.md` § Right-click is
 * state-dependent): idle opens the context menu on whatever is under the
 * cursor, while a car is being placed it ends the placement instead. Undo is
 * state-dependent in the same way and against the same states — the chain
 * interception is still ahead (#33), and this union is where it lands.
 *
 * `placing-car` is a car with one end: the first click named it, and the second
 * click completes the label (#32). It is **view state and never history** — an
 * uncommitted placement writes nothing, so abandoning one leaves the manifest
 * and the stack untouched. Chaining (#33) extends this case rather than adding
 * another, since every click after the first is simultaneously an end and the
 * next anchor.
 *
 * One gesture meaning two things is a real cost, accepted because the two
 * states differ by whether a placement is in progress — which the rubber band
 * (#33) makes loudly visible.
 */
type EditorMode =
  | { readonly kind: 'idle' }
  /** One end placed, waiting for the click that gives the car its other end. */
  | { readonly kind: 'placing-car'; readonly anchor: Point };

/**
 * What the open context menu acts on.
 *
 * The hit is resolved when the menu opens, not when a row is chosen, because
 * the menu names verbs for *that* object and the user may have moved on by the
 * time they pick one. `px` is the same staleness guard the calibration dialog
 * carries: an undo landing while the menu is up can slide an index onto a
 * different point, and points have no `id` to tell them apart. A sensor needs
 * no such guard — it carries an `id`, so the hit names it exactly however the
 * list is reordered underneath — and `px` is carried for it only so every
 * subject has the same shape.
 */
interface MenuSubject {
  readonly hit: HitTarget;
  readonly px: Point;
}

/**
 * Delete, the verb every object carries.
 *
 * It is why the editor needs no delete mode at all (`SPEC.md` § Right-click is
 * state-dependent). Reclassify — and the dotted class taxonomy as a submenu —
 * joins it when there are cars to reclassify. The `id` is what the editor
 * dispatches on and the label is what the user reads, so the same verb reads
 * correctly for each subject.
 */
const CALIBRATION_ITEMS: readonly ContextMenuItem[] = [
  { id: 'delete', label: 'Delete calibration point' },
];

/**
 * A sensor's verbs. Naming is here as well as on a click, because a name is
 * optional and an unnamed sensor gives a click nothing to discover.
 */
const SENSOR_ITEMS: readonly ContextMenuItem[] = [
  { id: 'name', label: 'Name sensor…' },
  { id: 'delete', label: 'Delete sensor' },
];

/**
 * A car's verbs. Delete only, and it is the whole error-correction path for a
 * label: deleting the middle car of three leaves two cars and no residue,
 * because a train is derived from coincident endpoints and there is nothing
 * else to clean up. Reclassify joins it as a submenu built from the authored
 * vocabulary (#35).
 */
const CAR_ITEMS: readonly ContextMenuItem[] = [{ id: 'delete', label: 'Delete car' }];

/**
 * What a right-click found: the object the menu will act on, and the rows it
 * offers for it — or null when there is nothing to offer.
 *
 * One switch resolves both, because a subject the menu cannot name a verb for
 * must not open a menu at all: a list of disabled rows is a worse answer than
 * the absence of one.
 *
 * A **coupler** opens nothing, and that is a deferral rather than an oversight:
 * its rows would have to name *which* of the coupled cars a verb acts on, and
 * that disambiguation belongs with the chaining that makes couplers routine
 * (#33). A coupler is reachable today only by dragging one car end onto
 * another's exact pixel, and the free ends of both cars still open a menu.
 */
function menuFor(
  hit: HitTarget,
  scene: HitScene
): { readonly subject: MenuSubject; readonly items: readonly ContextMenuItem[] } | null {
  switch (hit.kind) {
    case 'calibration': {
      const point = scene.calibrationPoints[hit.index];
      return point ? { subject: { hit, px: point.px }, items: CALIBRATION_ITEMS } : null;
    }
    case 'sensor': {
      const sensor = scene.sensors.find(s => s.id === hit.id);
      return sensor
        ? { subject: { hit, px: { x: sensor.x, y: sensor.y } }, items: SENSOR_ITEMS }
        : null;
    }
    case 'car-endpoint': {
      const [end] = hit.ends;
      const car = scene.cars.find(c => c.id === end.id);
      return car ? { subject: { hit, px: car[end.end] }, items: CAR_ITEMS } : null;
    }
    default:
      return null;
  }
}

/**
 * Whether a press or release is the primary button — the only one that authors.
 *
 * `button` is 0 for a left click, for a touch and for a pen tip, and 2 for a
 * right click; a `pointermove` reports -1, which is why only the ends of a
 * gesture are filtered. The editor reads it off `originalEvent` rather than
 * asking `rr-viewer` to, because which buttons mean something is the editor's
 * decision and the live view has no gestures at all.
 */
function isPrimaryButton(event: PointerEvent): boolean {
  return event.button <= 0;
}

/**
 * The pointer gesture currently in flight: one press, its moves, and its end.
 *
 * Everything a release needs is decided at **pointer-down** — what was under
 * the pointer, which handles move with it, and the history entry the whole
 * gesture will commit — so no motion event has to re-decide anything, and the
 * entry's snapshot is of the state before the first pixel moved.
 */
interface LiveGesture {
  /** Only this pointer drives the gesture; a second finger is ignored. */
  readonly pointerId: number;
  /** Where the press landed, in image pixels. Every delta is measured from here. */
  readonly origin: Point;
  /** What the press grabbed, or null for empty image. */
  readonly hit: HitTarget | null;
  /**
   * The points this gesture moves. A list, not one object: a coupler drag moves
   * two car ends and one entry has to cover both (`SPEC.md` § Undo and redo).
   */
  readonly handles: readonly DragHandle[];
  /** The one history entry, opened at pointer-down and committed at pointer-up. */
  readonly entry: HistoryGesture | null;
  /**
   * Set once the pointer leaves the click slop, and **sticky** thereafter: a
   * drag walked back to where it started is still a drag, and must not fall
   * through to the click path and open a dialog.
   */
  dragging: boolean;
}

/**
 * Main editor view: opens an archive, manages its images, reports DPT, and
 * authors calibration points, sensors and cars.
 *
 * **A click means whatever the active tool means** (#31). `rr-tool-palette`
 * chooses between calibration, sensor and car; the palette **gates the labeling
 * tools on DPT resolving**, and this component enforces the same gate — the
 * tool snaps back to calibration the moment the DPT stops resolving, so a
 * deleted or undone calibration point cannot leave a gated tool live.
 *
 * A click on empty image runs the active tool: calibration asks for the pixel's
 * world coordinate (#28), sensor places a point immediately, car takes two
 * clicks on the visible car ends and writes the span between them (#32). A
 * click **on an existing object** edits that object whatever the tool is — a
 * coordinate for a calibration point, a name for a sensor — because the object
 * under the cursor is less ambiguous than the mode; a car placement in
 * progress outranks even that, since its second click is what completes the
 * label. Dragging moves whatever it grabbed, as one entry per gesture (#30),
 * and right-click opens the context menu on it (#29): delete for any of the
 * three, and naming for a sensor.
 *
 * **Objects are keyed by `id`, never by object identity** — cars by label id,
 * sensors by sensor id, calibration points by position because they carry no
 * id. Applying a history snapshot replaces the objects wholesale, so a held
 * reference points at a stale object immediately afterwards.
 *
 * DPT is reported live, with the fit residual once the fit is over-determined,
 * and a DPT below `layout.min_dpt` warns **persistently and blocks nothing** —
 * the fixture corpus sits at 18–19 and must stay editable. See `SPEC.md`
 * § Reference points.
 *
 * The classifier is not loaded here: displaying per-marker predictions was the
 * only thing that used it, and there are no markers to predict for. Live
 * inference remains in `rr-live-view`.
 */
@customElement('rr-editor-view')
export class RREditorView extends LitElement {
  @property({ attribute: false }) archive: R49Archive | null = null;
  /**
   * The undo stack, owned by `rr-app`. Every mutation below goes through it —
   * an edit recorded nowhere leaves a stack that is wrong rather than short,
   * and nothing in the compiler catches that.
   */
  @property({ attribute: false }) history: EditHistory | null = null;
  @property({ type: Boolean }) canUndo = false;
  @property({ type: Boolean }) canRedo = false;
  @property({ attribute: false }) undoLabel: string | null = null;
  @property({ attribute: false }) redoLabel: string | null = null;
  @state() private _currentImageIndex = 0;
  @state() private _imageUrls: Map<string, string> = new Map();
  /**
   * What a click in the viewer means.
   *
   * Calibration is the default and the fallback: it is the only tool that works
   * on an uncalibrated archive, so an archive that opens without a DPT opens in
   * calibration mode and stays there until one resolves.
   */
  @state() private _tool: EditorTool = 'calibration';
  /** The click waiting on a coordinate, or null when no dialog is open. */
  private _pendingCalibration: PendingCalibration | null = null;
  /** The sensor whose name dialog is open, by `id`, or null when none is. */
  private _pendingSensorName: { readonly id: string } | null = null;
  /** The press in flight, or null between gestures. At most one at a time. */
  private _gesture: LiveGesture | null = null;
  /** What the context menu is open on, or null when it is closed. */
  private _menuSubject: MenuSubject | null = null;
  /** Which state the state-dependent gestures dispatch on. See {@link EditorMode}. */
  private _mode: EditorMode = { kind: 'idle' };

  @query('rr-calibration-dialog') private _calibrationDialog!: RRCalibrationDialog;
  @query('rr-sensor-dialog') private _sensorDialog!: RRSensorDialog;
  @query('rr-context-menu') private _contextMenu!: RRContextMenu;

  static styles = css`
    :host {
      display: flex;
      flex-grow: 1;
      height: 100%;
      overflow: hidden;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      /* The toolbar's own width, stated here as well so the palette below it
         wraps inside the same strip instead of widening the column to fit its
         gate note on one line. */
      width: 100px;
      flex-shrink: 0;
      /* The same dark green the toolbar and the palette sit on, so the column
         reads as one strip however much of it the two elements fill. */
      background-color: #064e3b;
      overflow-y: auto;
    }

    .main-content {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      background: #111;
      position: relative;
    }

    rr-viewer {
      flex-grow: 1;
    }

    rr-thumbnail-bar {
      flex-shrink: 0;
    }

    .placeholder {
      padding: 2rem;
      color: var(--sl-color-neutral-500);
    }

    .dpt-bar {
      flex-shrink: 0;
      padding: 0.5rem 1rem;
      font-family: var(--sl-font-mono);
      font-size: var(--sl-font-size-small);
      background: var(--sl-color-neutral-100);
      color: var(--sl-color-neutral-700);
      border-bottom: 1px solid var(--sl-color-neutral-200);
    }

    .dpt-bar.uncalibrated,
    .dpt-bar.below-minimum {
      background: var(--sl-color-warning-100);
      color: var(--sl-color-warning-800);
    }

    .dpt-bar .detail {
      margin-left: 1.5rem;
    }
  `;

  /**
   * Where the tool state is settled — **before** the render that shows it.
   *
   * Both branches set `_tool`, which is why they are here rather than in
   * `updated()`: a state write after the update has completed schedules a
   * second one, and Lit says so out loud.
   */
  protected willUpdate(changedProperties: Map<string, unknown>) {
    // A fresh archive brings its own state: an uncalibrated one opens in
    // calibration mode, and a calibrated one starts there too rather than
    // inheriting whichever tool the previous archive was left on. A half-placed
    // car goes with it — its anchor is a pixel on an image that is gone.
    if (changedProperties.has('archive')) {
      this._tool = 'calibration';
      this._abandonPlacement();
    }
    this._enforceGate();
  }

  async updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('archive') && this.archive) {
      await this._refreshImageUrls();
      this._currentImageIndex = 0;
    }
  }

  /**
   * Whether a DPT resolves — the whole of the calibration gate.
   *
   * Gated on **existence, never on completion** (`SPEC.md` § Labeling
   * Workflow): two points at a nonzero separation is exactly what `getDPT`
   * answers, so the gate is that one call and nothing else. A DPT below
   * `MIN_DPT` still counts — it warns and blocks nothing.
   */
  private _calibrated(): boolean {
    return this.archive !== null && getDPT(this.archive.getManifest()) !== null;
  }

  /**
   * Drops a gated tool back to calibration when the DPT stops resolving.
   *
   * Run before every render rather than at the one place a point is deleted,
   * because the DPT can also vanish through an **undo** — `rr-app` applies a
   * snapshot straight into the archive, and no editor handler sees it. Every
   * stage stays re-enterable, so this is a demotion and never a lock: placing a
   * second point re-enables the tools immediately.
   */
  private _enforceGate() {
    if (this._tool !== 'calibration' && !this._calibrated()) {
      this._tool = 'calibration';
      // A car being placed goes with the tool: its second click would have to
      // derive a width from a DPT that no longer resolves.
      this._abandonPlacement();
    }
  }

  /**
   * Drops a car placement in progress, wherever it is dropped from.
   *
   * One method rather than an assignment at each site, because **every** way
   * out of the editor's current state has to close it — a tool change, an image
   * change, a lost DPT, a new archive, a reveal after undo, a right-click — and
   * a state whose exits are scattered is a state that eventually leaks one. It
   * writes nothing and records nothing: an anchor is view state, so an
   * abandoned placement costs the manifest and the undo stack nothing
   * (`SPEC.md` § Undo and redo).
   */
  private _abandonPlacement() {
    this._mode = { kind: 'idle' };
  }

  /**
   * A tool change abandons a car placement, and writes nothing.
   *
   * The anchor belongs to the tool that took it — leaving it live would make
   * the next click with *another* tool complete a car the user stopped drawing.
   */
  private _onToolSelect(e: CustomEvent<ToolSelectDetail>) {
    this._tool = e.detail.tool;
    this._abandonPlacement();
  }

  private async _refreshImageUrls() {
    if (!this.archive) return;
    const manifest = this.archive.getManifest();

    // Revoke old URLs
    this._imageUrls.forEach(url => URL.revokeObjectURL(url));
    this._imageUrls.clear();

    for (const img of manifest.images) {
      const data = await this.archive.getImage(img.filename);
      if (data) {
        const blob = new Blob([data as any], { type: 'image/jpeg' });
        this._imageUrls.set(img.filename, URL.createObjectURL(blob));
      }
    }
    this.requestUpdate();
  }

  /**
   * Rebuilds the blob URLs from the archive and optionally selects an image.
   *
   * Called by `rr-app` after undo or redo: the manifest changed underneath this
   * component, and an entry scoped to another image must bring that image into
   * view before the change lands. See `history.ts`.
   */
  public async syncFromArchive(revealFilename?: string): Promise<void> {
    if (!this.archive) return;
    // An undo can select another image, and an anchor is a pixel on the image
    // it was clicked on: carried across, the next click would write a car with
    // one end from each frame. Labels are never carried between images
    // (`SPEC.md` § No copy-forward).
    this._abandonPlacement();
    await this._refreshImageUrls();
    const images = this.archive.getManifest().images;
    if (revealFilename) {
      const index = images.findIndex(img => img.filename === revealFilename);
      if (index >= 0) this._currentImageIndex = index;
    }
    this._currentImageIndex = Math.max(0, Math.min(this._currentImageIndex, images.length - 1));
  }

  /** Tells `rr-app` to re-render the undo affordances. */
  private _notifyHistoryChange() {
    this.dispatchEvent(new CustomEvent('rr-history-change', { bubbles: true, composed: true }));
  }

  /**
   * Selecting an image is **view state**: it shows that image's cars and
   * records no history entry, because nothing in the manifest changed.
   *
   * A car placement in progress does not survive it — its anchor is a pixel on
   * the image it was clicked on, and cars are never carried between images
   * (`SPEC.md` § No copy-forward).
   */
  private _onImageSelect(e: CustomEvent) {
    this._currentImageIndex = e.detail.index;
    this._abandonPlacement();
  }

  private async _onImageAdd(e: CustomEvent) {
    if (!this.archive) return;
    const { source } = e.detail;

    if (source === 'file') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png';
      input.onchange = async (event: any) => {
        const file = event.target.files[0];
        if (file) {
          const buffer = await file.arrayBuffer();
          const filename = `img_${make_id(2)}.jpg`;
          await this._record('add image', { kind: 'images' }, () =>
            this.archive!.addImage(filename, new Uint8Array(buffer))
          );
          await this._refreshImageUrls();
          this._currentImageIndex = this.archive!.getManifest().images.length - 1;
        }
      };
      input.click();
    } else if (source === 'camera') {
      try {
        const data = await captureFromCamera();
        const filename = `capture_${make_id(3)}.jpg`;
        await this._record('add image', { kind: 'images' }, () =>
          this.archive!.addImage(filename, data)
        );
        await this._refreshImageUrls();
        this._currentImageIndex = this.archive.getManifest().images.length - 1;
      } catch (err) {
        console.error('Failed to capture from camera', err);
      }
    }
  }

  private async _onImageDelete(e: CustomEvent) {
    if (!this.archive) return;
    const { index } = e.detail;
    const manifest = this.archive.getManifest();
    const image = manifest.images[index];
    if (image) {
      // `retain` is what makes the removal reversible: removeImage() drops the
      // bytes from the zip, so they have to be read out before it runs. Without
      // it the entry restores a manifest row naming an image that is not there.
      await this._record(
        'delete image',
        { kind: 'images' },
        () => this.archive!.removeImage(image.filename),
        { retain: [image.filename] }
      );
      await this._refreshImageUrls();
      this._currentImageIndex = Math.max(0, Math.min(this._currentImageIndex, manifest.images.length - 1));
    }
  }

  private async _onImageReorder(e: CustomEvent) {
    if (!this.archive) return;
    const { from, to } = e.detail;

    // Update current index if the selected image moved or if its position shifted
    if (this._currentImageIndex === from) {
      this._currentImageIndex = to;
    } else if (from < this._currentImageIndex && to >= this._currentImageIndex) {
      this._currentImageIndex--;
    } else if (from > this._currentImageIndex && to <= this._currentImageIndex) {
      this._currentImageIndex++;
    }

    await this._record('reorder images', { kind: 'images' }, () =>
      this.archive!.reorderImages(from, to)
    );
    this.requestUpdate();
  }

  /**
   * Runs a mutation through the undo stack, or directly when no history is
   * attached (tests that mount this component on its own).
   *
   * `target` is declared by the caller because only it knows which subtree it
   * touches, and mis-declaring it is the one class of bug scoped snapshots
   * admit — see `history.ts`.
   */
  private async _record(
    label: string,
    target: HistoryTarget,
    mutate: () => unknown,
    options?: { retain?: string[] }
  ) {
    if (!this.history) {
      await mutate();
      return;
    }
    await this.history.record(label, target, mutate, options);
    this._notifyHistoryChange();
  }

  /**
   * Everything a gesture needs, decided where the pointer went down.
   *
   * The hit-test runs **here** rather than at release: the press is where the
   * user aimed, and a drag has to know what it grabbed before it can move it.
   * The history entry opens here too, so its snapshot is of the state before
   * the first motion event — the whole gesture then costs one Cmd+Z, not one
   * per pixel of travel (`SPEC.md` § Undo and redo).
   *
   * A press arriving while a gesture is live is read by its `pointerId`. A
   * **different** one is a second finger, and is ignored rather than allowed to
   * replace the first. The **same** one cannot be a second finger — a pointer
   * cannot go down twice without going up — so it means the previous gesture's
   * end never arrived, and it is closed here rather than left to block every
   * press and every undo for the rest of the session. `rr-viewer` emits nothing
   * when it has no transform to convert with, which is one way that happens.
   */
  private _onViewerPointerDown(e: CustomEvent<ViewerPointerDetail>) {
    // Only the primary button authors anything. A right-click arrives through
    // these same pointer events, so without this the press that opens the
    // context menu also runs the click path and puts the calibration dialog up
    // behind it. Touch and pen report button 0, so nothing is lost there — and
    // a right press during a drag is ignored here rather than closing it.
    if (!isPrimaryButton(e.detail.originalEvent)) return;

    const pointerId = e.detail.originalEvent.pointerId;
    if (this._gesture) {
      if (this._gesture.pointerId !== pointerId) return;
      // Not awaited: this handler must have the new gesture in place before the
      // first pointer-move can arrive. `commit()` pushes its entry before it
      // yields, so the stale entry still lands ahead of the one opened below.
      void this._endGesture(this._gesture);
    }
    if (!this.archive) return;

    const at = e.detail.point;
    const scene = this._scene();
    const hit = hitTest(scene, at, this._tolerance(DEFAULT_GRAB_RADIUS_SCREEN_PX, e.detail));
    const handles = hit ? dragHandles(hit, scene) : [];

    this._gesture = {
      pointerId,
      origin: at,
      hit,
      handles,
      entry: hit && handles.length > 0 ? this._beginDragEntry(hit) : null,
      dragging: false,
    };
  }

  /** The image on screen, or undefined when the archive has none. */
  private _currentImage(): Image | undefined {
    return this.archive?.getManifest().images[this._currentImageIndex];
  }

  /**
   * Everything a pointer can land on, for the image on screen.
   *
   * Every gesture that asks "what is under here" reads it from here, so the
   * press, the right-click and the drag all see the same objects.
   *
   * Cars come from the **current image** and sensors from `layout`, which is
   * the whole of the per-image/per-layout distinction as a gesture sees it:
   * switching images swaps the cars and leaves the sensors, because a sensor is
   * placed once and answers for every frame (`SPEC.md` § Location Data).
   */
  private _scene(): HitScene {
    const manifest = this.archive?.getManifest();
    return {
      cars: this._currentImage()?.labels ?? [],
      sensors: manifest?.layout.sensors ?? [],
      calibrationPoints: manifest?.layout.calibration.points ?? [],
      // Not a thing to hit: the scale the world-sized objects are drawn at, so
      // a sensor is grabbable across the symbol the user can actually see.
      dpt: manifest ? getDPT(manifest) : null,
    };
  }

  /**
   * Opens the one history entry a drag will commit.
   *
   * The **target follows what was grabbed**, because that is the subtree the
   * gesture will write: a car end lives in one image record, a sensor and a
   * calibration point in `layout`. Mis-declaring it is the one class of bug
   * scoped snapshots admit. One entry still covers however many objects move
   * under it — a coupler drag's two cars share the one image record, which is
   * exactly why the target is a subtree and not an object.
   *
   * The label is what the undo tooltip reads back, so it names what moved.
   */
  private _beginDragEntry(hit: HitTarget): HistoryGesture | null {
    switch (hit.kind) {
      case 'car-endpoint':
      case 'coupler': {
        const filename = this._currentImage()?.filename;
        if (!filename) return null;
        const label = hit.kind === 'coupler' ? 'move coupler' : 'move car endpoint';
        return this.history?.beginGesture(label, { kind: 'image', filename }) ?? null;
      }
      case 'sensor':
        return this.history?.beginGesture('move sensor', { kind: 'layout' }) ?? null;
      case 'calibration':
        return this.history?.beginGesture('move calibration point', { kind: 'layout' }) ?? null;
    }
  }

  /**
   * Motion, which becomes a drag only once it clears the click slop.
   *
   * Nothing is recorded here — the open entry already holds the pre-drag
   * snapshot, so the manifest is free to be written on every event.
   */
  private _onViewerPointerMove(e: CustomEvent<ViewerPointerDetail>) {
    const gesture = this._current(e);
    if (!gesture) return;

    if (!gesture.dragging) {
      if (isClick(gesture.origin, e.detail.point, this._tolerance(CLICK_SLOP_SCREEN_PX, e.detail))) {
        return;
      }
      gesture.dragging = true;
    }
    this._moveHandles(gesture, e.detail.point);
  }

  /**
   * The end of the gesture: commit what moved, or interpret the click.
   *
   * One entry lands here or none at all — a drag returned to its origin leaves
   * the subtree byte-identical, and `EditHistory` suppresses it by value rather
   * than by trusting that the user meant it.
   *
   * A gesture that dragged never falls through to the click path, even if it
   * ended back inside the slop. Without that, every swipe over the image would
   * place a point, and the labeling device is a phone.
   *
   * The click itself splits twice. A **placement in progress wins outright**:
   * the second click of a car is the click that gives it its other end, and
   * interpreting it as anything else would strand the anchor. Otherwise **an
   * object under the cursor is edited whatever the tool is**, and only a click
   * on empty image is dispatched on the active tool — anything else would let
   * the sensor tool stack a sensor on a calibration point the user was aiming
   * at.
   */
  private async _onViewerPointerUp(e: CustomEvent<ViewerPointerDetail>) {
    // The mouse reports one `pointerId` for every button, so the release of a
    // secondary button carries the id of a left drag still in progress. Ending
    // that drag here would commit it on a press the user did not mean as one.
    if (!isPrimaryButton(e.detail.originalEvent)) return;

    const gesture = this._current(e);
    if (!gesture) return;

    if (gesture.dragging) this._moveHandles(gesture, e.detail.point);
    await this._endGesture(gesture);
    if (gesture.dragging) return;
    if (!isClick(gesture.origin, e.detail.point, this._tolerance(CLICK_SLOP_SCREEN_PX, e.detail))) {
      return;
    }

    // The click names a pixel, so that is what is stored — a fractional
    // coordinate would be precision the gesture does not have.
    const px = { x: Math.round(gesture.origin.x), y: Math.round(gesture.origin.y) };

    if (this._mode.kind === 'placing-car') {
      await this._completeCar(this._mode.anchor, px);
      return;
    }

    if (gesture.hit) {
      await this._editHit(gesture.hit);
      return;
    }

    await this._useTool(px);
  }

  /**
   * A click that landed on an object: edit *that* object, whatever the tool is.
   *
   * What "edit" means is the object's own property that a click can ask for —
   * a calibration point's world coordinate, a sensor's name. A **car end has no
   * such property**: its position is what a drag is for and its class is what
   * the context menu is for (#35), so a click on one does nothing. Doing
   * nothing is the right answer rather than falling through to the tool and
   * stacking something on top of the label the user was aiming at.
   */
  private async _editHit(hit: HitTarget) {
    switch (hit.kind) {
      case 'calibration': {
        const point = this.archive!.getManifest().layout.calibration.points[hit.index];
        if (!point) return;
        this._pendingCalibration = { kind: 'edit', index: hit.index, px: point.px };
        await this._calibrationDialog.show(point.world, { mode: 'edit' });
        return;
      }
      case 'sensor': {
        await this._openSensorName(hit.id);
        return;
      }
      default:
        return;
    }
  }

  /**
   * A click on empty image, dispatched on the active tool.
   *
   * The gate is re-checked here rather than trusted from the palette: the
   * palette is a view of `_tool`, and a click is what actually writes. A gated
   * tool cannot be active — {@link _enforceGate} demotes it — so this is the
   * belt to that braces, not a second policy.
   */
  private async _useTool(px: Point) {
    switch (this._tool) {
      case 'calibration':
        this._pendingCalibration = { kind: 'place', px };
        await this._calibrationDialog.show();
        return;
      case 'sensor':
        if (!this._calibrated()) return;
        await this._placeSensor(px);
        return;
      case 'car':
        if (!this._calibrated() || !this._currentImage()) return;
        // The first of two clicks: it names one end and writes nothing. An
        // abandoned placement therefore costs the manifest and the undo stack
        // nothing at all.
        this._mode = { kind: 'placing-car', anchor: px };
        return;
    }
  }

  /**
   * The second click: write the car, as one entry scoped to its image.
   *
   * A car is the straight chord between two free clicks on the visible ends
   * (`SPEC.md` § Authoring cars) — no snapping, because v4 stores no track to
   * snap to, and the photograph shows the labeler where the car actually is.
   * Width is **not** stored: it is derived from DPT at render time, which is
   * what the calibration gate buys.
   *
   * `provenance: 'human'` with **no** `proposed_by` — the schema forbids the
   * key on a human label, because a default of `human` on model output is the
   * exact feedback loop provenance exists to make measurable. `class` is the
   * taxonomy root; refinement is the context menu's job (#35).
   *
   * The mode drops to idle either way, so a click that lands with no image —
   * the last one was deleted underneath the placement — abandons rather than
   * leaving an anchor pointing at a frame that is gone.
   */
  private async _completeCar(anchor: Point, px: Point) {
    this._abandonPlacement();
    const image = this._currentImage();
    if (!image) return;

    const car: CarLabel = {
      id: make_id(CAR_NODE_ID),
      class: NEW_CAR_CLASS,
      provenance: 'human',
      p0: anchor,
      p1: px,
    };
    await this._record('place car', { kind: 'image', filename: image.filename }, () => {
      this._writeImage(image.filename, { labels: [...image.labels, car] });
    });
  }

  /**
   * Places a sensor at a pixel, as one `layout` entry.
   *
   * Unnamed, and that is a complete sensor rather than a half-finished one:
   * consumers key on `id`, and `name` is optional passthrough that is **never
   * auto-generated** (`SPEC.md` § Occupancy Output). The id is a snowflake from
   * `@occupancy/uid`, unique within the layout because it is unique full stop.
   *
   * No provenance field exists to set: no model can propose where a human wants
   * an answer, so the format gives sensors none.
   */
  private async _placeSensor(px: Point) {
    const manifest = this.archive!.getManifest();
    await this._record('place sensor', { kind: 'layout' }, () => {
      this._writeLayout({
        sensors: [...manifest.layout.sensors, { id: make_id(SENSOR_NODE_ID), x: px.x, y: px.y }],
      });
    });
  }

  /** The sensor with this id, or undefined once it is gone. */
  private _sensor(id: string): Sensor | undefined {
    return this.archive?.getManifest().layout.sensors.find(s => s.id === id);
  }

  /** Opens the name dialog on a sensor, if it is still there. */
  private async _openSensorName(id: string) {
    const sensor = this._sensor(id);
    if (!sensor) return;
    this._pendingSensorName = { id };
    await this._sensorDialog.show(sensor.name ?? null, { id });
  }

  /**
   * The browser took the gesture away: it ended nowhere and means nothing.
   *
   * What moved goes back to exactly where it started — restoring the handles
   * rather than the snapshot, so a cancelled drag is undone even when no
   * history is attached. The entry is then closed against an unchanged subtree
   * and records nothing.
   */
  private async _onViewerPointerCancel(e: CustomEvent<ViewerPointerDetail>) {
    const gesture = this._current(e);
    if (!gesture) return;

    if (gesture.dragging) this._moveHandles(gesture, gesture.origin);
    await this._endGesture(gesture);
  }

  /**
   * Right-click, dispatched on the editor's state.
   *
   * The browser's own menu is suppressed **here** rather than in `rr-viewer`,
   * and for every right-click the viewer reports rather than only the ones that
   * open something: inside the labeling surface a right-click is the editor's
   * gesture whatever it lands on, and once a chain can be live the same press
   * ends it over empty image. The live view shares the viewer and does not
   * listen, so its right-click stays the browser's.
   *
   * The state branch is the point of this handler (`SPEC.md` § Right-click is
   * state-dependent): idle opens the menu, and a car placement in progress
   * **ends the placement instead** — the same gesture that will end a chain
   * (#33), which a one-car placement is the first click of.
   */
  private _onViewerContextMenu(e: CustomEvent<ViewerContextMenuDetail>) {
    e.detail.originalEvent.preventDefault();

    // A press is still in flight: the object under the cursor is mid-drag, and
    // a menu naming verbs for a position the user has not settled on would act
    // on geometry that is about to change. The gesture keeps the pointer.
    if (this._gesture) return;

    switch (this._mode.kind) {
      case 'idle':
        void this._openContextMenu(e.detail);
        return;
      case 'placing-car':
        // Nothing was written, so nothing is undone: the anchor is view state.
        // No menu opens either — one gesture means one thing per state.
        this._abandonPlacement();
        return;
    }
  }

  /**
   * The idle branch: a menu on the object under the cursor.
   *
   * Empty image opens nothing, and so does an object with no verbs — see
   * {@link menuFor}. The subject is resolved now rather than when a row is
   * chosen, because the rows are named for *this* object.
   */
  private async _openContextMenu(detail: ViewerContextMenuDetail) {
    this._menuSubject = null;
    this._contextMenu.hide();
    if (!this.archive) return;

    const scene = this._scene();
    const hit = hitTest(
      scene,
      detail.point,
      this._tolerance(DEFAULT_GRAB_RADIUS_SCREEN_PX, detail)
    );
    if (!hit) return;

    const menu = menuFor(hit, scene);
    if (!menu) return;

    this._menuSubject = menu.subject;
    // The cursor, in the frame it was reported in: the menu is placed on the
    // glass, which is the one editor position that is a screen coordinate.
    await this._contextMenu.show(
      { x: detail.originalEvent.clientX, y: detail.originalEvent.clientY },
      menu.items
    );
  }

  /** A row was chosen. The menu has closed itself by the time this runs. */
  private async _onContextMenuSelect(e: CustomEvent<ContextMenuSelectDetail>) {
    const subject = this._menuSubject;
    this._menuSubject = null;
    if (!subject || !this.archive) return;

    switch (e.detail.id) {
      case 'delete':
        await this._deleteSubject(subject);
        return;
      case 'name':
        if (subject.hit.kind === 'sensor') await this._openSensorName(subject.hit.id);
        return;
    }
  }

  /**
   * Whether the point at `index` is still the one a gesture was aimed at.
   *
   * A dialog and a menu both outlive the click that opened them, and an undo
   * landing in between can remove that point, or remove another one and slide
   * this index onto a different point. Points carry no `id`, so the pixel is
   * what identifies one: a target that moved is dropped rather than edited or
   * deleted from underneath the user.
   */
  private _pointIsStillAt(index: number, px: Point): boolean {
    const point = this.archive?.getManifest().layout.calibration.points[index];
    return point !== undefined && point.px.x === px.x && point.px.y === px.y;
  }

  /**
   * Deletes the menu's subject, as one entry scoped to the subtree it touches.
   *
   * Undo restores the object with everything it carried, because an entry is a
   * snapshot rather than an inverse command — there is no per-object restore to
   * author here, and therefore none to author wrongly.
   */
  private async _deleteSubject(subject: MenuSubject) {
    switch (subject.hit.kind) {
      case 'calibration': {
        const { index } = subject.hit;
        if (!this._pointIsStillAt(index, subject.px)) return;

        await this._record('delete calibration point', { kind: 'layout' }, () => {
          const points = [...this.archive!.getManifest().layout.calibration.points];
          points.splice(index, 1);
          this._writeLayout({ calibrationPoints: points });
        });
        return;
      }
      case 'sensor': {
        // Keyed by `id`, so there is nothing to go stale: the hit names one
        // sensor however the list is reordered or replaced underneath. It can
        // still be *gone*, which is why the filter is a filter and not a splice.
        const { id } = subject.hit;
        if (!this._sensor(id)) return;

        await this._record('delete sensor', { kind: 'layout' }, () => {
          this._writeLayout({
            sensors: this.archive!.getManifest().layout.sensors.filter(s => s.id !== id),
          });
        });
        return;
      }
      case 'car-endpoint': {
        // Keyed by label `id`, like the sensor above: the hit names one car
        // however the array is replaced underneath, and the same id is what
        // undo restores it under. Deleting one car of a train leaves no
        // residue — a train is derived from coincident endpoints, so there is
        // nothing else that names the car that went.
        const { id } = subject.hit.ends[0];
        const image = this._currentImage();
        if (!image || !image.labels.some(car => car.id === id)) return;

        await this._record('delete car', { kind: 'image', filename: image.filename }, () => {
          this._writeImage(image.filename, {
            labels: image.labels.filter(car => car.id !== id),
          });
        });
        return;
      }
      default:
        return;
    }
  }

  /**
   * Closes a gesture: one entry for everything it moved, or none at all.
   *
   * Every ending goes through here, including the two that are not the
   * gesture's own — a repeated `pointerId`, which says the previous up never
   * arrived, and teardown, since `rr-app` replaces this element on the view
   * toggle and an entry left open would refuse every undo for the rest of the
   * session. Both **commit** rather than revert: the objects visibly moved and
   * the user has an undo for that, where a silent revert would be the editor
   * deciding it knew better.
   */
  private async _endGesture(gesture: LiveGesture) {
    if (this._gesture === gesture) this._gesture = null;
    if (await gesture.entry?.commit()) this._notifyHistoryChange();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._gesture) void this._endGesture(this._gesture);
  }

  /** The live gesture, if this event belongs to it. */
  private _current(e: CustomEvent<ViewerPointerDetail>): LiveGesture | null {
    const gesture = this._gesture;
    if (!gesture || gesture.pointerId !== e.detail.originalEvent.pointerId) return null;
    return gesture;
  }

  /** A screen-pixel tolerance in the zoom the viewer just reported. */
  private _tolerance(
    screenPx: number,
    detail: ViewerPointerDetail | ViewerContextMenuDetail
  ): HitTolerance {
    return { screenPx, imagePxPerScreenPx: detail.imagePxPerScreenPx };
  }

  /**
   * Writes every handle of the gesture to where `to` puts it.
   *
   * The delta is measured from the press and applied to each handle's starting
   * position, so all of them take the identical translation: that is what keeps
   * a coupler's ends on the same pixel, and a coupling is exact coincidence.
   *
   * The two subtrees are written separately because that is where the objects
   * live: calibration points and sensors in `layout`, car labels in one image
   * record. A gesture only ever grabs one kind — the handles come from a single
   * hit — so the entry opened at pointer-down names the right one, and **only
   * the subtree the handles are in is written**. Writing the other as well
   * would be value-identical today and still wrong: the open entry snapshots
   * one subtree, and touching the other is a write outside what it declared.
   */
  private _moveHandles(gesture: LiveGesture, to: Point) {
    if (!this.archive || gesture.handles.length === 0) return;
    const delta = { x: to.x - gesture.origin.x, y: to.y - gesture.origin.y };
    const layout = this.archive.getManifest().layout;
    const points = [...layout.calibration.points];
    const sensors = [...layout.sensors];
    const image = this._currentImage();
    const labels = image ? [...image.labels] : [];
    let movedLayout = false;
    let movedLabels = false;

    for (const handle of gesture.handles) {
      switch (handle.ref.kind) {
        case 'calibration': {
          const point = points[handle.ref.index];
          if (point) points[handle.ref.index] = { ...point, px: dragTo(handle, delta) };
          movedLayout = true;
          break;
        }
        case 'sensor': {
          const id = handle.ref.id;
          const index = sensors.findIndex(s => s.id === id);
          if (index >= 0) {
            const at = dragTo(handle, delta);
            sensors[index] = { ...sensors[index], x: at.x, y: at.y };
          }
          movedLayout = true;
          break;
        }
        case 'car-end': {
          const { id, end } = handle.ref;
          const index = labels.findIndex(label => label.id === id);
          if (index >= 0) {
            const at = dragTo(handle, delta);
            // Written per end rather than through a computed key, so the
            // discriminated union survives the rebuild: a car carries its
            // provenance and a spread that widened it would stop typechecking
            // where it matters.
            labels[index] =
              end === 'p0' ? { ...labels[index], p0: at } : { ...labels[index], p1: at };
          }
          movedLabels = true;
          break;
        }
      }
    }

    if (movedLayout) this._writeLayout({ calibrationPoints: points, sensors });
    if (movedLabels && image) this._writeImage(image.filename, { labels });
  }

  /**
   * Replaces the parts of `layout` a gesture touched, and re-renders.
   *
   * The arrays and the objects in them are rebuilt rather than mutated in
   * place, because a history snapshot is taken by value and the editor must not
   * hold a reference to an object undo will replace. Lit does not observe
   * mutations inside `R49Archive`, hence the explicit `requestUpdate()` — which
   * is what carries a mid-drag position into the DPT readout.
   *
   * An omitted key is left alone, so a caller states exactly what it changed
   * and a sensor write cannot silently rewrite the calibration beside it.
   */
  private _writeLayout(changes: {
    calibrationPoints?: readonly CalibrationPoint[];
    sensors?: readonly Sensor[];
  }) {
    const manifest = this.archive!.getManifest();
    manifest.layout = {
      ...manifest.layout,
      ...(changes.calibrationPoints
        ? {
            calibration: {
              ...manifest.layout.calibration,
              points: [...changes.calibrationPoints],
            },
          }
        : {}),
      ...(changes.sensors ? { sensors: [...changes.sensors] } : {}),
    };
    this.requestUpdate();
  }

  /**
   * Replaces the parts of one image record a gesture touched, and re-renders.
   *
   * The per-image mirror of {@link _writeLayout}, and rebuilt by value for the
   * same reason: a history snapshot is taken by value, so the editor must hold
   * no reference to an object undo will replace. Addressed by **filename**, not
   * by index — an entry scoped to another image can reorder the array while a
   * dialog or a menu is open.
   */
  private _writeImage(filename: string, changes: { labels?: readonly CarLabel[] }) {
    const manifest = this.archive!.getManifest();
    const index = manifest.images.findIndex(img => img.filename === filename);
    if (index < 0) return;

    manifest.images[index] = {
      ...manifest.images[index],
      ...(changes.labels ? { labels: [...changes.labels] } : {}),
    };
    this.requestUpdate();
  }

  /** The coordinate came back: write the point as one `layout` entry. */
  private async _onCalibrationCommit(e: CustomEvent<CalibrationCommitDetail>) {
    const pending = this._pendingCalibration;
    this._pendingCalibration = null;
    if (!pending || !this.archive) return;

    const manifest = this.archive.getManifest();
    // The dialog can have outlived the point it was opened on — see
    // {@link _pointIsStillAt}.
    if (pending.kind === 'edit' && !this._pointIsStillAt(pending.index, pending.px)) return;

    const label = pending.kind === 'place' ? 'place calibration point' : 'edit calibration point';
    await this._record(label, { kind: 'layout' }, () => {
      const points = [...manifest.layout.calibration.points];
      if (pending.kind === 'place') {
        points.push({ px: pending.px, world: e.detail.world });
      } else {
        points[pending.index] = { ...points[pending.index], world: e.detail.world };
      }
      this._writeLayout({ calibrationPoints: points });
    });
  }

  /**
   * The name came back: write it as one `layout` entry, or drop it.
   *
   * `null` **removes** the key rather than storing an empty string — `name` is
   * absent when unset, and a stored `""` would be a name that displays as
   * nothing while still counting as one. Retyping the same name records
   * nothing: `EditHistory.record` suppresses a no-op by value.
   *
   * The sensor is looked up by `id` when the dialog closes, so a sensor deleted
   * or undone while it was open is simply gone and the commit does nothing —
   * exactly the staleness guard `_pointIsStillAt` provides for a point, but
   * exact, because a sensor has an id and a point does not.
   */
  private async _onSensorNameCommit(e: CustomEvent<SensorNameCommitDetail>) {
    const pending = this._pendingSensorName;
    this._pendingSensorName = null;
    if (!pending || !this.archive || !this._sensor(pending.id)) return;

    const { name } = e.detail;
    const manifest = this.archive.getManifest();
    await this._record('name sensor', { kind: 'layout' }, () => {
      this._writeLayout({
        sensors: manifest.layout.sensors.map(sensor => {
          if (sensor.id !== pending.id) return sensor;
          const renamed: Sensor = { id: sensor.id, x: sensor.x, y: sensor.y };
          return name === null ? renamed : { ...renamed, name };
        }),
      });
    });
  }

  /**
   * DPT readout, plus what makes it trustworthy.
   *
   * `null` means no calibration pair resolves a scale — a real v4 state, not an
   * error, so it is reported with what to do about it. The residual appears
   * only once the fit is over-determined, where it says something: a mis-typed
   * coordinate is otherwise absorbed silently into the scale. A DPT below
   * `MIN_DPT` **warns and blocks nothing** — the six fixture archives sit at
   * 18–19 and must stay openable and editable (`SPEC.md` § Reference points).
   */
  private _renderDpt(manifest: ManifestData) {
    const dpt = getDPT(manifest);
    if (dpt === null) {
      return html`<div class="dpt-bar uncalibrated">
        Not calibrated — click the image to place calibration points. Two points at
        different positions resolve DPT.
      </div>`;
    }

    const residual = getDPTResidual(manifest);
    const belowMinimum = dpt < MIN_DPT;

    return html`<div class="dpt-bar ${belowMinimum ? 'below-minimum' : ''}">
      DPT ${dpt.toFixed(1)}
      ${residual !== null
        ? html`<span class="detail">fit residual ${residual.toFixed(1)} px</span>`
        : ''}
      ${belowMinimum
        ? html`<span class="detail">
            below the minimum of ${MIN_DPT} — cars are too few pixels across for reliable
            detection. Editing is not blocked.
          </span>`
        : ''}
    </div>`;
  }

  render() {
    const manifest = this.archive?.getManifest();
    const currentImage = manifest?.images[this._currentImageIndex];
    const src = currentImage ? this._imageUrls.get(currentImage.filename) : null;

    return html`
      <div class="sidebar">
        <rr-toolbar
          .canUndo=${this.canUndo}
          .canRedo=${this.canRedo}
          .undoLabel=${this.undoLabel}
          .redoLabel=${this.redoLabel}
        ></rr-toolbar>

        ${manifest
          ? html`<rr-tool-palette
              .tool=${this._tool}
              ?calibrated=${this._calibrated()}
              @rr-tool-select=${this._onToolSelect}
            ></rr-tool-palette>`
          : ''}
      </div>

      <div class="main-content">
        ${!this.archive || !manifest
          ? html`<div class="placeholder">No archive loaded. Use the toolbar to open an .r49 file.</div>`
          : html`
            ${this._renderDpt(manifest)}

            <rr-viewer
              .src=${src}
              .resolution=${manifest.camera.resolution}
              .calibrationPoints=${manifest.layout.calibration.points}
              .sensors=${manifest.layout.sensors}
              .cars=${currentImage?.labels ?? []}
              .dpt=${getDPT(manifest)}
              @rr-pointer-down=${this._onViewerPointerDown}
              @rr-pointer-move=${this._onViewerPointerMove}
              @rr-pointer-up=${this._onViewerPointerUp}
              @rr-pointer-cancel=${this._onViewerPointerCancel}
              @rr-pointer-contextmenu=${this._onViewerContextMenu}
            ></rr-viewer>

            <rr-thumbnail-bar
              .images=${manifest.images.map(img => this._imageUrls.get(img.filename) || '')}
              .selectedIndex=${this._currentImageIndex}
              @rr-image-select=${this._onImageSelect}
              @rr-image-add=${this._onImageAdd}
              @rr-image-delete=${this._onImageDelete}
              @rr-image-reorder=${this._onImageReorder}
            ></rr-thumbnail-bar>

            <rr-calibration-dialog
              @rr-calibration-commit=${this._onCalibrationCommit}
            ></rr-calibration-dialog>

            <rr-sensor-dialog
              @rr-sensor-name-commit=${this._onSensorNameCommit}
            ></rr-sensor-dialog>

            <rr-context-menu
              @rr-context-menu-select=${this._onContextMenuSelect}
            ></rr-context-menu>
          `
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-editor-view': RREditorView;
  }
}
