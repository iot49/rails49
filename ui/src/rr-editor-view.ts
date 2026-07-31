import { LitElement, html, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { R49Archive, getDPT, getDPTResidual } from '@occupancy/r49';
import type { ManifestData, Point } from '@occupancy/r49';
import { MIN_DPT } from '@occupancy/config';
import { make_id } from '@occupancy/uid';
import { captureFromCamera } from './capture.js';
import {
  hitTest,
  isClick,
  CLICK_SLOP_SCREEN_PX,
  DEFAULT_GRAB_RADIUS_SCREEN_PX,
} from './geometry.js';
import type { EditHistory, HistoryTarget } from './history.js';
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
 * Main editor view: opens an archive, manages its images, reports DPT, and
 * authors calibration points.
 *
 * **Calibration points are the only geometry it authors** (#28). A click asks
 * for the pixel's world coordinate and records one `layout` history entry; a
 * click on an existing point edits that point's coordinate instead. Cars and
 * sensors, the tool palette that would choose between them, the context menu
 * and dragging are later tickets (#29–#31); until the palette exists, a click
 * in the viewer means "calibrate", which is the only tool there is.
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
  /** Where the live gesture began, so a release can tell a click from a drag. */
  private _gestureStart: { readonly point: Point; readonly pointerId: number } | null = null;

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

  /** Remembers where the gesture began; nothing is decided until it ends. */
  private _onViewerPointerDown(e: CustomEvent<ViewerPointerDetail>) {
    this._gestureStart = {
      point: e.detail.point,
      pointerId: e.detail.originalEvent.pointerId,
    };
  }

  /** The browser took the gesture away: it ended nowhere and means nothing. */
  private _onViewerPointerCancel() {
    this._gestureStart = null;
  }

  /**
   * A finished gesture in the viewer, which today can only mean "calibrate".
   *
   * A press and a release more than `CLICK_SLOP_SCREEN_PX` apart is a drag, and
   * a drag does nothing yet (#30 gives it meaning) — without that test every
   * swipe across the image would place a point, and the labeling device is a
   * phone. The **press** position is what gets used: it is where the user
   * aimed, and where a drag would have grabbed.
   *
   * When the tool palette arrives (#31) this is where the active tool is
   * dispatched on. Neither that nor dragging is anticipated here beyond keeping
   * the seam.
   */
  private async _onViewerPointerUp(e: CustomEvent<ViewerPointerDetail>) {
    const start = this._gestureStart;
    this._gestureStart = null;
    if (!this.archive || !start) return;
    if (start.pointerId !== e.detail.originalEvent.pointerId) return;

    const tolerance = {
      screenPx: CLICK_SLOP_SCREEN_PX,
      imagePxPerScreenPx: e.detail.imagePxPerScreenPx,
    };
    if (!isClick(start.point, e.detail.point, tolerance)) return;

    const at = start.point;
    const points = this.archive.getManifest().layout.calibration.points;

    // Only calibration points are in the scene: they are the only object this
    // editor authors. Cars and sensors join it with the tools that create them.
    const hit = hitTest({ cars: [], sensors: [], calibrationPoints: points }, at, {
      screenPx: DEFAULT_GRAB_RADIUS_SCREEN_PX,
      imagePxPerScreenPx: e.detail.imagePxPerScreenPx,
    });

    if (hit?.kind === 'calibration') {
      const point = points[hit.index];
      this._pendingCalibration = { kind: 'edit', index: hit.index, px: point.px };
      await this._calibrationDialog.show(point.world, { mode: 'edit' });
      return;
    }

    // The click names a pixel, so that is what is stored — a fractional
    // coordinate would be precision the gesture does not have.
    this._pendingCalibration = {
      kind: 'place',
      px: { x: Math.round(at.x), y: Math.round(at.y) },
    };
    await this._calibrationDialog.show();
  }

  /**
   * The coordinate came back: write the point as one `layout` entry.
   *
   * The points array is rebuilt rather than mutated in place, because a history
   * snapshot is taken by value and the editor must not hold a reference to an
   * object undo will replace.
   */
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
      manifest.layout = {
        ...manifest.layout,
        calibration: { ...manifest.layout.calibration, points },
      };
    });
    this.requestUpdate();
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
