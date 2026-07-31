import { LitElement, html, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { R49Archive, getDPT, getDPTResidual } from '@occupancy/r49';
import type { CalibrationPoint, ManifestData, Point } from '@occupancy/r49';
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
import type { DragHandle, HitTarget, HitTolerance } from './geometry.js';
import type { EditHistory, HistoryGesture, HistoryTarget } from './history.js';
import type { ViewerPointerDetail } from './rr-viewer.js';
import type { CalibrationCommitDetail, RRCalibrationDialog } from './rr-calibration-dialog.js';

import './rr-viewer.js';
import './rr-toolbar.js';
import './rr-thumbnail-bar.js';
import './rr-calibration-dialog.js';

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
 * authors calibration points.
 *
 * **Calibration points are the only geometry it authors** (#28). A click asks
 * for the pixel's world coordinate and records one `layout` history entry; a
 * click on an existing point edits that point's coordinate instead; a **drag**
 * moves it, as one entry per gesture (#30). Cars and sensors, the tool palette
 * that would choose between them, and the context menu are later tickets (#29,
 * #31); until the palette exists, a click in the viewer means "calibrate",
 * which is the only tool there is.
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
  /** The click waiting on a coordinate, or null when no dialog is open. */
  private _pendingCalibration: PendingCalibration | null = null;
  /** The press in flight, or null between gestures. At most one at a time. */
  private _gesture: LiveGesture | null = null;

  @query('rr-calibration-dialog') private _calibrationDialog!: RRCalibrationDialog;

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

  async updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('archive') && this.archive) {
      await this._refreshImageUrls();
      this._currentImageIndex = 0;
    }
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

  private _onImageSelect(e: CustomEvent) {
    this._currentImageIndex = e.detail.index;
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
    // Only calibration points are in the scene: they are the only object this
    // editor authors. Cars and sensors join it with the tools that create them.
    const scene = {
      cars: [],
      sensors: [],
      calibrationPoints: this.archive.getManifest().layout.calibration.points,
    };
    const hit = hitTest(scene, at, this._tolerance(DEFAULT_GRAB_RADIUS_SCREEN_PX, e.detail));
    const handles = hit ? dragHandles(hit, scene) : [];

    this._gesture = {
      pointerId,
      origin: at,
      hit,
      handles,
      entry: handles.length > 0 ? this._beginDragEntry() : null,
      dragging: false,
    };
  }

  /**
   * Opens the one history entry a drag will commit.
   *
   * Every handle a press can grab today lives in `layout`. A coupler drag's two
   * cars would open one `image` entry the same way — one target, one entry,
   * however many objects move under it.
   */
  private _beginDragEntry(): HistoryGesture | null {
    return this.history?.beginGesture('move calibration point', { kind: 'layout' }) ?? null;
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
   * When the tool palette arrives (#31) this is where the active tool is
   * dispatched on.
   */
  private async _onViewerPointerUp(e: CustomEvent<ViewerPointerDetail>) {
    const gesture = this._current(e);
    if (!gesture) return;

    if (gesture.dragging) this._moveHandles(gesture, e.detail.point);
    await this._endGesture(gesture);
    if (gesture.dragging) return;
    if (!isClick(gesture.origin, e.detail.point, this._tolerance(CLICK_SLOP_SCREEN_PX, e.detail))) {
      return;
    }

    if (gesture.hit?.kind === 'calibration') {
      const point = this.archive!.getManifest().layout.calibration.points[gesture.hit.index];
      if (!point) return;
      this._pendingCalibration = { kind: 'edit', index: gesture.hit.index, px: point.px };
      await this._calibrationDialog.show(point.world, { mode: 'edit' });
      return;
    }

    // The click names a pixel, so that is what is stored — a fractional
    // coordinate would be precision the gesture does not have.
    this._pendingCalibration = {
      kind: 'place',
      px: { x: Math.round(gesture.origin.x), y: Math.round(gesture.origin.y) },
    };
    await this._calibrationDialog.show();
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
  private _tolerance(screenPx: number, detail: ViewerPointerDetail): HitTolerance {
    return { screenPx, imagePxPerScreenPx: detail.imagePxPerScreenPx };
  }

  /**
   * Writes every handle of the gesture to where `to` puts it.
   *
   * The delta is measured from the press and applied to each handle's starting
   * position, so all of them take the identical translation: that is what keeps
   * a coupler's ends on the same pixel, and a coupling is exact coincidence.
   *
   * Only calibration handles are written, because they are the only objects the
   * hit-test scene contains — a car end or a sensor cannot be grabbed until the
   * tools that create them exist (#31), and their writes arrive with them.
   */
  private _moveHandles(gesture: LiveGesture, to: Point) {
    if (!this.archive || gesture.handles.length === 0) return;
    const delta = { x: to.x - gesture.origin.x, y: to.y - gesture.origin.y };
    const points = [...this.archive.getManifest().layout.calibration.points];

    for (const handle of gesture.handles) {
      if (handle.ref.kind !== 'calibration') continue;
      const point = points[handle.ref.index];
      if (!point) continue;
      points[handle.ref.index] = { ...point, px: dragTo(handle, delta) };
    }

    this._writeCalibrationPoints(points);
  }

  /**
   * Replaces the layout's calibration points, and re-renders.
   *
   * The array and the objects around it are rebuilt rather than mutated in
   * place, because a history snapshot is taken by value and the editor must not
   * hold a reference to an object undo will replace. Lit does not observe
   * mutations inside `R49Archive`, hence the explicit `requestUpdate()` — which
   * is what carries a mid-drag position into the DPT readout.
   */
  private _writeCalibrationPoints(points: readonly CalibrationPoint[]) {
    const manifest = this.archive!.getManifest();
    manifest.layout = {
      ...manifest.layout,
      calibration: { ...manifest.layout.calibration, points: [...points] },
    };
    this.requestUpdate();
  }

  /** The coordinate came back: write the point as one `layout` entry. */
  private async _onCalibrationCommit(e: CustomEvent<CalibrationCommitDetail>) {
    const pending = this._pendingCalibration;
    this._pendingCalibration = null;
    if (!pending || !this.archive) return;

    const manifest = this.archive.getManifest();
    const current = manifest.layout.calibration.points;
    // An undo while the dialog was open can have removed the point, or removed
    // another one and slid this index onto a different point. The index alone
    // cannot tell those apart — points carry no `id` — so the pixel the dialog
    // was opened on is what identifies it, and an edit whose target moved is
    // dropped rather than applied to whatever now sits at that index.
    if (pending.kind === 'edit') {
      const target = current[pending.index];
      if (!target || target.px.x !== pending.px.x || target.px.y !== pending.px.y) return;
    }

    const label = pending.kind === 'place' ? 'place calibration point' : 'edit calibration point';
    await this._record(label, { kind: 'layout' }, () => {
      const points = [...manifest.layout.calibration.points];
      if (pending.kind === 'place') {
        points.push({ px: pending.px, world: e.detail.world });
      } else {
        points[pending.index] = { ...points[pending.index], world: e.detail.world };
      }
      this._writeCalibrationPoints(points);
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
              @rr-pointer-down=${this._onViewerPointerDown}
              @rr-pointer-move=${this._onViewerPointerMove}
              @rr-pointer-up=${this._onViewerPointerUp}
              @rr-pointer-cancel=${this._onViewerPointerCancel}
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
