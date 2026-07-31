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
import type { DragHandle, HitScene, HitTarget, HitTolerance } from './geometry.js';
import type { EditHistory, HistoryGesture, HistoryTarget } from './history.js';
import type { ViewerContextMenuDetail, ViewerPointerDetail } from './rr-viewer.js';
import type { CalibrationCommitDetail, RRCalibrationDialog } from './rr-calibration-dialog.js';
import type {
  ContextMenuItem,
  ContextMenuSelectDetail,
  RRContextMenu,
} from './rr-context-menu.js';

import './rr-viewer.js';
import './rr-toolbar.js';
import './rr-thumbnail-bar.js';
import './rr-calibration-dialog.js';
import './rr-context-menu.js';

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
 * One member today. Right-click is state-dependent by design (`SPEC.md`
 * § Right-click is state-dependent): idle opens the context menu on whatever is
 * under the cursor, while chaining a train it ends the chain instead. Undo is
 * state-dependent in the same way and against the same states. Car authoring
 * brings `{ kind: 'chaining' }` and the branches that read it; the dispatch
 * below is a switch so that is a case to add rather than a rewrite.
 *
 * One gesture meaning two things is a real cost, accepted because the two
 * states differ by whether a chain is in progress — which the rubber band makes
 * loudly visible.
 */
type EditorMode = { readonly kind: 'idle' };

/**
 * What the open context menu acts on.
 *
 * The hit is resolved when the menu opens, not when a row is chosen, because
 * the menu names verbs for *that* object and the user may have moved on by the
 * time they pick one. `px` is the same staleness guard the calibration dialog
 * carries: an undo landing while the menu is up can slide an index onto a
 * different point, and points have no `id` to tell them apart.
 */
interface MenuSubject {
  readonly hit: HitTarget;
  readonly px: Point;
}

/**
 * Delete, the one verb the menu carries today.
 *
 * It is why the editor needs no delete mode at all (`SPEC.md` § Right-click is
 * state-dependent). Reclassify — and the dotted class taxonomy as a submenu —
 * joins it when there are cars to reclassify.
 */
const DELETE_ITEM: ContextMenuItem = { id: 'delete', label: 'Delete calibration point' };

/**
 * What a right-click found: the object the menu will act on, and the rows it
 * offers for it — or null when there is nothing to offer.
 *
 * One switch resolves both, because a subject the menu cannot name a verb for
 * must not open a menu at all: a list of disabled rows is a worse answer than
 * the absence of one. Only calibration points are in the hit-test scene today;
 * cars and sensors join it with the tools that create them (#31), and their
 * rows arrive here, through this same switch.
 */
function menuFor(
  hit: HitTarget,
  scene: HitScene
): { readonly subject: MenuSubject; readonly items: readonly ContextMenuItem[] } | null {
  switch (hit.kind) {
    case 'calibration': {
      const point = scene.calibrationPoints[hit.index];
      return point ? { subject: { hit, px: point.px }, items: [DELETE_ITEM] } : null;
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
 * authors calibration points.
 *
 * **Calibration points are the only geometry it authors** (#28). A click asks
 * for the pixel's world coordinate and records one `layout` history entry; a
 * click on an existing point edits that point's coordinate instead; a **drag**
 * moves it, as one entry per gesture (#30); a **right-click** opens the context
 * menu on it and deletes it from there (#29). Cars and sensors, and the tool
 * palette that would choose between them, are a later ticket (#31); until the
 * palette exists, a click in the viewer means "calibrate", which is the only
 * tool there is.
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
  /** What the context menu is open on, or null when it is closed. */
  private _menuSubject: MenuSubject | null = null;
  /** Which state the state-dependent gestures dispatch on. See {@link EditorMode}. */
  private _mode: EditorMode = { kind: 'idle' };

  @query('rr-calibration-dialog') private _calibrationDialog!: RRCalibrationDialog;
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
      entry: handles.length > 0 ? this._beginDragEntry() : null,
      dragging: false,
    };
  }

  /**
   * Everything a pointer can land on, for the image on screen.
   *
   * Only calibration points are in it: they are the only object this editor
   * authors. Cars and sensors join the scene with the tools that create them,
   * and every gesture that asks "what is under here" reads it from here, so
   * they arrive for the press, the right-click and the drag at once.
   */
  private _scene(): HitScene {
    return {
      cars: [],
      sensors: [],
      calibrationPoints: this.archive?.getManifest().layout.calibration.points ?? [],
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
   * state-dependent). Only {@link EditorMode}'s idle case exists; chaining ends
   * the chain instead, and is a case to add here.
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
          this._writeCalibrationPoints(points);
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
