import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import { R49Archive, getDPT } from '@occupancy/r49';
import type { CalibrationPoint, Point, WorldPoint } from '@occupancy/r49';
import { EditHistory } from '../src/history.js';
import '../src/rr-editor-view.js';
import { RREditorView } from '../src/rr-editor-view.js';
import type { RRCalibrationDialog } from '../src/rr-calibration-dialog.js';

// Mock ResizeObserver for RRViewer
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver for Shoelace
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock matchMedia for Shoelace
window.matchMedia = vi.fn().mockImplementation(query => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// Mock getAnimations/animate for Shoelace
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = vi.fn().mockReturnValue([]);
}
if (!Element.prototype.animate) {
  Element.prototype.animate = vi.fn().mockImplementation(() => ({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    reverse: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('rr-editor-view', () => {
  let archive: R49Archive;

  beforeEach(async () => {
    // Create a dummy archive
    archive = new R49Archive();
    archive.setManifest({
      version: 4,
      layout: { name: 'Test Layout', scale: 'N', calibration: { points: [] }, sensors: [] },
      camera: { resolution: { width: 100, height: 100 } },
      images: [
        { filename: 'img1.jpg', labeled_complete: false, labels: [] }
      ]
    });

    // Mock getImage to return empty data
    vi.spyOn(archive, 'getImage').mockResolvedValue(new Uint8Array());

    // Mock URL.createObjectURL
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('is defined', () => {
    const el = document.createElement('rr-editor-view');
    expect(el).to.be.instanceOf(RREditorView);
  });

  it('renders placeholder when no archive is provided', async () => {
    const el = await fixture<RREditorView>(html`<rr-editor-view></rr-editor-view>`);
    expect(el.shadowRoot!.textContent).to.contain('No archive loaded');
  });

  it('renders components when archive is provided', async () => {
    const el = await fixture<RREditorView>(html`
      <rr-editor-view .archive=${archive}></rr-editor-view>
    `);

    expect(el.shadowRoot!.querySelector('rr-toolbar')).to.exist;
    expect(el.shadowRoot!.querySelector('rr-viewer')).to.exist;
    expect(el.shadowRoot!.querySelector('rr-thumbnail-bar')).to.exist;
  });

  describe('DPT readout', () => {
    it('reports "not calibrated" when no DPT resolves', async () => {
      const el = await fixture<RREditorView>(html`
        <rr-editor-view .archive=${archive}></rr-editor-view>
      `);
      const bar = el.shadowRoot!.querySelector('.dpt-bar')!;
      expect(bar).to.exist;
      expect(bar.classList.contains('uncalibrated')).to.be.true;
      expect(bar.textContent).to.contain('Not calibrated');
    });

    it('reports the DPT when calibration resolves', async () => {
      // 100 px over 10 mm in N scale (gauge 1435/160 mm) => 10 px/mm * 8.97 mm
      archive.getManifest().layout.calibration = {
        points: [
          { px: { x: 0, y: 0 }, world: { x: 0, y: 0, z: 0 } },
          { px: { x: 100, y: 0 }, world: { x: 10, y: 0, z: 0 } },
        ],
      };

      const el = await fixture<RREditorView>(html`
        <rr-editor-view .archive=${archive}></rr-editor-view>
      `);
      const bar = el.shadowRoot!.querySelector('.dpt-bar')!;
      expect(bar.classList.contains('uncalibrated')).to.be.false;
      expect(bar.textContent).to.contain('DPT 89.7');
    });
  });

  // Car authoring and sensor placement are still absent — they belong to the
  // editor spec's later tickets (#31). Calibration points are the one thing
  // this editor authors, and they go through `calibrationPoints`.
  it('passes no interactive or marker state to the viewer', async () => {
    const el = await fixture<RREditorView>(html`
      <rr-editor-view .archive=${archive}></rr-editor-view>
    `);
    const viewer = el.shadowRoot!.querySelector('rr-viewer')! as any;

    expect(viewer.interactive).to.be.undefined;
    expect(viewer.activeTool).to.be.undefined;
    expect(viewer.calibration).to.be.undefined;
    expect(viewer.markers).to.deep.equal([]);
  });

  describe('calibration authoring', () => {
    /** Lets the editor's async pointer and commit handlers settle. */
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    /** One `rr-pointer-*` event, shaped the way `rr-viewer` emits it. */
    function gesture(
      el: RREditorView,
      name: string,
      point: Point,
      imagePxPerScreenPx: number,
      pointerId = 1
    ) {
      el.shadowRoot!.querySelector('rr-viewer')!.dispatchEvent(
        new CustomEvent(name, {
          detail: {
            point,
            imagePxPerScreenPx,
            originalEvent: Object.assign(new MouseEvent(name), { pointerId }),
          },
          bubbles: true,
          composed: true,
        })
      );
    }

    /** A press and a release at the same pixel: a click. */
    async function clickAt(el: RREditorView, point: Point, imagePxPerScreenPx = 1) {
      gesture(el, 'rr-pointer-down', point, imagePxPerScreenPx);
      gesture(el, 'rr-pointer-up', point, imagePxPerScreenPx);
      await flush();
      await el.updateComplete;
    }

    /** A press, a run of moves, and a release. One gesture, one pointerId. */
    async function drag(el: RREditorView, path: readonly Point[], imagePxPerScreenPx = 1) {
      gesture(el, 'rr-pointer-down', path[0], imagePxPerScreenPx);
      for (const point of path.slice(1)) {
        gesture(el, 'rr-pointer-move', point, imagePxPerScreenPx);
      }
      gesture(el, 'rr-pointer-up', path[path.length - 1], imagePxPerScreenPx);
      await flush();
      await el.updateComplete;
    }

    /** What the dialog emits when the user confirms a coordinate. */
    async function commit(el: RREditorView, world: WorldPoint) {
      el.shadowRoot!.querySelector('rr-calibration-dialog')!.dispatchEvent(
        new CustomEvent('rr-calibration-commit', {
          detail: { world },
          bubbles: true,
          composed: true,
        })
      );
      await flush();
      await el.updateComplete;
    }

    function dialogOf(el: RREditorView): RRCalibrationDialog {
      return el.shadowRoot!.querySelector('rr-calibration-dialog')!;
    }

    /** Silences the real dialog's DOM work and records how it was opened. */
    function stubDialog(el: RREditorView) {
      const dialog = dialogOf(el);
      return vi.spyOn(dialog, 'show').mockResolvedValue(undefined);
    }

    function points(): CalibrationPoint[] {
      return archive.getManifest().layout.calibration.points;
    }

    async function mount(history?: EditHistory) {
      const el = await fixture<RREditorView>(html`
        <rr-editor-view .archive=${archive} .history=${history ?? null}></rr-editor-view>
      `);
      stubDialog(el);
      return el;
    }

    it('shows the layout\'s calibration points on the viewer', async () => {
      archive.getManifest().layout.calibration.points = [
        { px: { x: 10, y: 20 }, world: { x: 0, y: 0, z: 0 } },
      ];
      const el = await mount();
      const viewer = el.shadowRoot!.querySelector('rr-viewer')!;
      expect(viewer.calibrationPoints).to.deep.equal(points());
    });

    it('asks for a coordinate on a click, and places nothing until it is given', async () => {
      const el = await mount();
      const show = stubDialog(el);

      await clickAt(el, { x: 120, y: 200 });

      expect(show).toHaveBeenCalledOnce();
      expect(points()).to.have.length(0);
    });

    it('places the clicked pixel once the coordinate commits', async () => {
      const el = await mount();
      await clickAt(el, { x: 120.4, y: 200.6 });
      await commit(el, { x: 0, y: 250, z: 0 });

      // The click names a pixel, so the stored position is a whole one.
      expect(points()).to.deep.equal([
        { px: { x: 120, y: 201 }, world: { x: 0, y: 250, z: 0 } },
      ]);
    });

    it('records one layout entry per placement, and undo reverses it', async () => {
      const history = new EditHistory();
      history.attach(archive);
      const el = await mount(history);

      await clickAt(el, { x: 10, y: 10 });
      await commit(el, { x: 0, y: 0, z: 0 });
      await clickAt(el, { x: 110, y: 10 });
      await commit(el, { x: 10, y: 0, z: 0 });

      expect(history.size).to.equal(2);
      expect(points()).to.have.length(2);

      const entry = await history.undo();
      expect(entry!.target).to.deep.equal({ kind: 'layout' });
      expect(entry!.label).to.contain('calibration');
      expect(points()).to.have.length(1);

      await history.redo();
      expect(points()).to.have.length(2);
    });

    it('edits the point under the click instead of stacking another on it', async () => {
      archive.getManifest().layout.calibration.points = [
        { px: { x: 100, y: 100 }, world: { x: 0, y: 0, z: 0 } },
      ];
      const history = new EditHistory();
      history.attach(archive);
      const el = await mount(history);
      const show = stubDialog(el);

      // Within the grab radius of the existing point.
      await clickAt(el, { x: 105, y: 103 });
      expect(show).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, { mode: 'edit' });

      await commit(el, { x: 0, y: 250, z: 0 });

      expect(points()).to.deep.equal([
        { px: { x: 100, y: 100 }, world: { x: 0, y: 250, z: 0 } },
      ]);
      expect(history.size).to.equal(1);

      await history.undo();
      expect(points()[0].world).to.deep.equal({ x: 0, y: 0, z: 0 });
    });

    it('places a new point when the click is beyond the grab radius', async () => {
      archive.getManifest().layout.calibration.points = [
        { px: { x: 100, y: 100 }, world: { x: 0, y: 0, z: 0 } },
      ];
      const el = await mount();
      await clickAt(el, { x: 300, y: 300 });
      await commit(el, { x: 20, y: 0, z: 0 });

      expect(points()).to.have.length(2);
    });

    it('scales the grab radius with the zoom the viewer reports', async () => {
      archive.getManifest().layout.calibration.points = [
        { px: { x: 100, y: 100 }, world: { x: 0, y: 0, z: 0 } },
      ];
      const el = await mount();
      const show = stubDialog(el);

      // 40 image px away: outside the radius at 1:1, inside it when each screen
      // pixel covers four image pixels.
      await clickAt(el, { x: 140, y: 100 }, 4);

      expect(show).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, { mode: 'edit' });
    });

    it('ignores a drag, so a swipe over the image places nothing', async () => {
      const el = await mount();
      const show = stubDialog(el);

      await drag(el, [{ x: 100, y: 100 }, { x: 400, y: 250 }]);

      expect(show).not.toHaveBeenCalled();
      expect(points()).to.have.length(0);
    });

    it('tolerates the hand tremor inside a click, and uses the press position', async () => {
      const el = await mount();
      // Two image pixels apart at 1:1 — inside the slop.
      gesture(el, 'rr-pointer-down', { x: 300, y: 200 }, 1);
      gesture(el, 'rr-pointer-up', { x: 302, y: 201 }, 1);
      await flush();
      await el.updateComplete;
      await commit(el, { x: 0, y: 0, z: 0 });

      expect(points()[0].px).to.deep.equal({ x: 300, y: 200 });
    });

    describe('dragging', () => {
      /** One calibration point, at a round pixel. */
      function seed(...pixels: readonly Point[]) {
        archive.getManifest().layout.calibration.points = pixels.map((px, i) => ({
          px,
          world: { x: i * 10, y: 0, z: 0 },
        }));
      }

      it('moves the point that was grabbed, keeping the grab offset', async () => {
        seed({ x: 100, y: 100 });
        const el = await mount();
        const show = stubDialog(el);

        // Pressed three pixels off-center: the point must translate by the
        // delta, not teleport under the cursor.
        await drag(el, [
          { x: 103, y: 102 },
          { x: 150, y: 150 },
          { x: 203, y: 202 },
        ]);

        expect(points()[0].px).to.deep.equal({ x: 200, y: 200 });
        expect(show).not.toHaveBeenCalled();
      });

      it('records exactly one entry however many move events fired', async () => {
        seed({ x: 100, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);

        const path: Point[] = [{ x: 100, y: 100 }];
        for (let i = 1; i <= 200; i++) path.push({ x: 100 + i, y: 100 });
        await drag(el, path);

        expect(points()[0].px).to.deep.equal({ x: 300, y: 100 });
        expect(history.size).to.equal(1);
        expect(history.undoLabel).to.contain('calibration');
      });

      it('undo returns the point to where the drag began, and redo reapplies it', async () => {
        seed({ x: 100, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);

        await drag(el, [
          { x: 100, y: 100 },
          { x: 400, y: 250 },
        ]);
        expect(points()[0].px).to.deep.equal({ x: 400, y: 250 });

        const entry = await history.undo();
        expect(entry!.target).to.deep.equal({ kind: 'layout' });
        expect(points()[0].px).to.deep.equal({ x: 100, y: 100 });

        await history.redo();
        expect(points()[0].px).to.deep.equal({ x: 400, y: 250 });
      });

      it('records nothing for a drag returned to its origin', async () => {
        seed({ x: 100, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);
        const show = stubDialog(el);

        await drag(el, [
          { x: 100, y: 100 },
          { x: 400, y: 250 },
          { x: 100, y: 100 },
        ]);

        expect(points()[0].px).to.deep.equal({ x: 100, y: 100 });
        expect(history.size).to.equal(0);
        expect(history.isDirty).to.be.false;
        // And it is still a drag, not a click: the dialog must not open on a
        // gesture the user spent moving something.
        expect(show).not.toHaveBeenCalled();
      });

      it('commits a drag that leaves the viewer, since the pointer is captured', async () => {
        // The capture lives in `rr-viewer`; what the editor owes it is not
        // bailing on coordinates outside the image. The overlay covers the
        // letterbox and a captured drag reports past the element entirely.
        seed({ x: 100, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);

        await drag(el, [
          { x: 100, y: 100 },
          { x: -400, y: -300 },
        ]);

        expect(points()[0].px).to.deep.equal({ x: -400, y: -300 });
        expect(history.size).to.equal(1);
      });

      it('restores the point and records nothing when the browser cancels', async () => {
        seed({ x: 100, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);

        gesture(el, 'rr-pointer-down', { x: 100, y: 100 }, 1);
        gesture(el, 'rr-pointer-move', { x: 400, y: 250 }, 1);
        gesture(el, 'rr-pointer-cancel', { x: 400, y: 250 }, 1);
        await flush();
        await el.updateComplete;

        expect(points()[0].px).to.deep.equal({ x: 100, y: 100 });
        expect(history.size).to.equal(0);
      });

      it('ignores a second finger arriving mid-drag', async () => {
        seed({ x: 100, y: 100 }, { x: 500, y: 500 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);

        gesture(el, 'rr-pointer-down', { x: 100, y: 100 }, 1, 1);
        gesture(el, 'rr-pointer-down', { x: 500, y: 500 }, 1, 2);
        gesture(el, 'rr-pointer-move', { x: 600, y: 600 }, 1, 2);
        gesture(el, 'rr-pointer-up', { x: 600, y: 600 }, 1, 2);
        gesture(el, 'rr-pointer-move', { x: 140, y: 130 }, 1, 1);
        gesture(el, 'rr-pointer-up', { x: 140, y: 130 }, 1, 1);
        await flush();
        await el.updateComplete;

        // The second finger moved nothing, and the first still committed once.
        expect(points()[1].px).to.deep.equal({ x: 500, y: 500 });
        expect(points()[0].px).to.deep.equal({ x: 140, y: 130 });
        expect(history.size).to.equal(1);
      });

      it('restores a cancelled drag with no history attached at all', async () => {
        // The restore is by handle, not by snapshot, precisely so it does not
        // depend on a stack being there.
        seed({ x: 100, y: 100 });
        const el = await mount();

        gesture(el, 'rr-pointer-down', { x: 100, y: 100 }, 1);
        gesture(el, 'rr-pointer-move', { x: 400, y: 250 }, 1);
        gesture(el, 'rr-pointer-cancel', { x: 400, y: 250 }, 1);
        await flush();
        await el.updateComplete;

        expect(points()[0].px).to.deep.equal({ x: 100, y: 100 });
      });

      it('closes a gesture whose end never arrived, rather than wedging on it', async () => {
        // `rr-viewer` emits nothing when it has no transform to convert with, so
        // an up can go missing. A press on the same pointerId cannot be a second
        // finger — a pointer does not go down twice — so it ends the stale one,
        // which keeps both the editor and undo responsive.
        seed({ x: 100, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);

        gesture(el, 'rr-pointer-down', { x: 100, y: 100 }, 1);
        gesture(el, 'rr-pointer-move', { x: 300, y: 300 }, 1);
        await flush();
        // No pointer-up: the gesture is left open.

        await drag(el, [{ x: 300, y: 300 }, { x: 350, y: 350 }]);

        expect(points()[0].px).to.deep.equal({ x: 350, y: 350 });
        // One entry for the abandoned gesture, one for the drag that followed.
        expect(history.size).to.equal(2);
        expect(await history.undo()).to.not.be.null;
      });

      it('closes an open gesture when the element goes away', async () => {
        // `rr-app` replaces this element on the view toggle. An entry left open
        // there would refuse every undo for the rest of the session.
        seed({ x: 100, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);

        gesture(el, 'rr-pointer-down', { x: 100, y: 100 }, 1);
        gesture(el, 'rr-pointer-move', { x: 300, y: 300 }, 1);
        await flush();
        el.remove();
        await flush();

        expect(history.size).to.equal(1);
        expect(await history.undo()).to.not.be.null;
        expect(points()[0].px).to.deep.equal({ x: 100, y: 100 });
      });

      it('moves nothing when the drag starts on empty image', async () => {
        seed({ x: 100, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);
        const show = stubDialog(el);

        await drag(el, [
          { x: 600, y: 600 },
          { x: 700, y: 700 },
        ]);

        expect(points()[0].px).to.deep.equal({ x: 100, y: 100 });
        expect(history.size).to.equal(0);
        expect(show).not.toHaveBeenCalled();
      });

      it('takes the DPT readout with it', async () => {
        // 100 px over 10 mm, then 200 px over the same 10 mm: the scale doubles
        // under the drag, live, without a save or a reopen.
        seed({ x: 0, y: 0 }, { x: 100, y: 0 });
        const el = await mount();
        const bar = () => el.shadowRoot!.querySelector('.dpt-bar')!.textContent!;
        expect(bar()).to.contain('DPT 89.7');

        gesture(el, 'rr-pointer-down', { x: 100, y: 0 }, 1);
        gesture(el, 'rr-pointer-move', { x: 200, y: 0 }, 1);
        await flush();
        await el.updateComplete;

        // Mid-gesture, before the pointer is even released.
        expect(bar()).to.contain('DPT 179.4');
      });

      it('still opens the dialog for a click on a point', async () => {
        // The click path is unchanged: a press and a release inside the slop
        // edits, and only a gesture that actually moved suppresses that.
        seed({ x: 100, y: 100 });
        const el = await mount();
        const show = stubDialog(el);

        await clickAt(el, { x: 102, y: 101 });

        expect(show).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, { mode: 'edit' });
        expect(points()[0].px).to.deep.equal({ x: 100, y: 100 });
      });
    });

    it('drops an edit whose point moved underneath the open dialog', async () => {
      const layout = archive.getManifest().layout;
      layout.calibration.points = [
        { px: { x: 100, y: 100 }, world: { x: 0, y: 0, z: 0 } },
        { px: { x: 400, y: 100 }, world: { x: 10, y: 0, z: 0 } },
      ];
      const el = await mount();

      // Open the dialog on the second point, then have the first vanish — an
      // undo landing while the dialog is up. Index 1 now names a point the
      // dialog was never opened on.
      await clickAt(el, { x: 400, y: 100 });
      layout.calibration = { points: [layout.calibration.points[1]] };
      await commit(el, { x: 999, y: 999, z: 999 });

      expect(points()).to.deep.equal([
        { px: { x: 400, y: 100 }, world: { x: 10, y: 0, z: 0 } },
      ]);
    });

    it('round-trips through a save and reopen', async () => {
      const el = await mount();
      await clickAt(el, { x: 0, y: 0 });
      await commit(el, { x: 0, y: 0, z: 0 });
      await clickAt(el, { x: 100, y: 0 });
      await commit(el, { x: 10, y: 0, z: 0 });

      const reopened = await R49Archive.load(await archive.export());

      expect(reopened.getManifest().layout.calibration.points).to.deep.equal(points());
      expect(getDPT(reopened.getManifest())).to.equal(getDPT(archive.getManifest()));
    });

    it('places nothing when the dialog is dismissed', async () => {
      const history = new EditHistory();
      history.attach(archive);
      const el = await mount(history);

      await clickAt(el, { x: 10, y: 10 });
      // No commit: the user cancelled.

      expect(points()).to.have.length(0);
      expect(history.size).to.equal(0);
    });

    it('updates the DPT readout as points are added', async () => {
      const el = await mount();
      const bar = () => el.shadowRoot!.querySelector('.dpt-bar')!;

      expect(bar().textContent).to.contain('Not calibrated');

      await clickAt(el, { x: 0, y: 0 });
      await commit(el, { x: 0, y: 0, z: 0 });
      expect(bar().textContent).to.contain('Not calibrated');

      await clickAt(el, { x: 100, y: 0 });
      await commit(el, { x: 10, y: 0, z: 0 });
      expect(bar().textContent).to.contain('DPT 89.7');
      expect(getDPT(archive.getManifest())).to.be.closeTo(89.7, 0.1);
    });

    it('shows the fit residual only once the fit is over-determined', async () => {
      const layout = archive.getManifest().layout;
      layout.calibration.points = [
        { px: { x: 0, y: 0 }, world: { x: 0, y: 0, z: 0 } },
        { px: { x: 100, y: 0 }, world: { x: 10, y: 0, z: 0 } },
      ];
      const el = await mount();
      expect(el.shadowRoot!.querySelector('.dpt-bar')!.textContent).to.not.contain('residual');

      // A third point that disagrees: 210 px where the fitted scale says 200.
      await clickAt(el, { x: 210, y: 0 });
      await commit(el, { x: 20, y: 0, z: 0 });

      const text = el.shadowRoot!.querySelector('.dpt-bar')!.textContent!;
      expect(text).to.contain('residual');
      expect(text).to.match(/residual \d/);
    });

    it('warns persistently below the minimum DPT without blocking anything', async () => {
      // 100 px over 50 mm in N scale => DPT 17.9, where the fixture corpus sits.
      archive.getManifest().layout.calibration.points = [
        { px: { x: 0, y: 0 }, world: { x: 0, y: 0, z: 0 } },
        { px: { x: 100, y: 0 }, world: { x: 50, y: 0, z: 0 } },
      ];
      const el = await mount();

      const bar = el.shadowRoot!.querySelector('.dpt-bar')!;
      expect(bar.classList.contains('below-minimum')).to.be.true;
      expect(bar.textContent).to.contain('DPT 17.9');
      expect(bar.textContent).to.contain('20');

      // Never blocks: the warning is still up and a third point still lands.
      await clickAt(el, { x: 200, y: 0 });
      await commit(el, { x: 100, y: 0, z: 0 });

      expect(points()).to.have.length(3);
      expect(el.shadowRoot!.querySelector('.dpt-bar')!.classList.contains('below-minimum')).to.be.true;
    });
  });

  it('still manages images', async () => {
    const el = await fixture<RREditorView>(html`
      <rr-editor-view .archive=${archive}></rr-editor-view>
    `);
    const bar = el.shadowRoot!.querySelector('rr-thumbnail-bar')!;

    bar.dispatchEvent(new CustomEvent('rr-image-delete', { detail: { index: 0 } }));
    await el.updateComplete;

    expect(archive.getManifest().images).to.have.length(0);
  });
});
