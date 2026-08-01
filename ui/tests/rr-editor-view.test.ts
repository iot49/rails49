import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import { R49Archive, getDPT } from '@occupancy/r49';
import type { CalibrationPoint, CarLabel, Point, Sensor, WorldPoint } from '@occupancy/r49';
import { EditHistory } from '../src/history.js';
import '../src/rr-editor-view.js';
import { RREditorView } from '../src/rr-editor-view.js';
import type { RRCalibrationDialog } from '../src/rr-calibration-dialog.js';
import type { RRSensorDialog } from '../src/rr-sensor-dialog.js';
import type { RRToolPalette, EditorTool } from '../src/rr-tool-palette.js';
import type { RRContextMenu } from '../src/rr-context-menu.js';

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

  /** Lets the editor's async pointer and commit handlers settle. */
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  /**
   * One `rr-pointer-*` event, shaped the way `rr-viewer` emits it.
   *
   * `pointerId` tells a second finger from the first; `button` is 0 for the
   * primary press and 2 for a right-click, which the editor must not author
   * on.
   */
  function gesture(
    el: RREditorView,
    name: string,
    point: Point,
    imagePxPerScreenPx: number,
    { pointerId = 1, button = 0 }: { pointerId?: number; button?: number } = {}
  ) {
    el.shadowRoot!.querySelector('rr-viewer')!.dispatchEvent(
      new CustomEvent(name, {
        detail: {
          point,
          imagePxPerScreenPx,
          originalEvent: Object.assign(new MouseEvent(name, { button }), { pointerId }),
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

  /** The same, for the sensor name dialog. */
  function stubSensorDialog(el: RREditorView) {
    const dialog = el.shadowRoot!.querySelector<RRSensorDialog>('rr-sensor-dialog')!;
    return vi.spyOn(dialog, 'show').mockResolvedValue(undefined);
  }

  function points(): CalibrationPoint[] {
    return archive.getManifest().layout.calibration.points;
  }

  function sensors(): Sensor[] {
    return archive.getManifest().layout.sensors;
  }

  async function mount(history?: EditHistory) {
    const el = await fixture<RREditorView>(html`
      <rr-editor-view .archive=${archive} .history=${history ?? null}></rr-editor-view>
    `);
    stubDialog(el);
    stubSensorDialog(el);
    return el;
  }

  function menuOf(el: RREditorView): RRContextMenu {
    return el.shadowRoot!.querySelector('rr-context-menu')!;
  }

  /** The menu's rows, by id. Empty when it is closed. */
  function menuItems(el: RREditorView): string[] {
    return [...menuOf(el).shadowRoot!.querySelectorAll('sl-menu-item')].map(
      item => item.getAttribute('value') ?? ''
    );
  }

  /**
   * A right-click, shaped the way `rr-viewer` emits one. Returns the
   * underlying event so the caller can check the native menu was suppressed.
   */
  async function rightClickAt(
    el: RREditorView,
    point: Point,
    client: { x: number; y: number } = { x: 0, y: 0 },
    imagePxPerScreenPx = 1
  ): Promise<MouseEvent> {
    const originalEvent = new MouseEvent('contextmenu', {
      cancelable: true,
      clientX: client.x,
      clientY: client.y,
    });
    el.shadowRoot!.querySelector('rr-viewer')!.dispatchEvent(
      new CustomEvent('rr-pointer-contextmenu', {
        detail: { point, imagePxPerScreenPx, originalEvent },
        bubbles: true,
        composed: true,
      })
    );
    await flush();
    await el.updateComplete;
    await menuOf(el).updateComplete;
    return originalEvent;
  }

  /**
   * Chooses a row the way `sl-menu` reports one, so the whole chain runs:
   * the menu closes itself and the editor hears the selection.
   */
  async function choose(el: RREditorView, id: string) {
    const menu = menuOf(el);
    const item = menu.shadowRoot!.querySelector(`sl-menu-item[value="${id}"]`)!;
    menu.shadowRoot!.querySelector('sl-menu')!.dispatchEvent(
      new CustomEvent('sl-select', { detail: { item }, bubbles: true, composed: true })
    );
    await flush();
    await el.updateComplete;
  }

  describe('calibration authoring', () => {
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

        gesture(el, 'rr-pointer-down', { x: 100, y: 100 }, 1, { pointerId: 1 });
        gesture(el, 'rr-pointer-down', { x: 500, y: 500 }, 1, { pointerId: 2 });
        gesture(el, 'rr-pointer-move', { x: 600, y: 600 }, 1, { pointerId: 2 });
        gesture(el, 'rr-pointer-up', { x: 600, y: 600 }, 1, { pointerId: 2 });
        gesture(el, 'rr-pointer-move', { x: 140, y: 130 }, 1, { pointerId: 1 });
        gesture(el, 'rr-pointer-up', { x: 140, y: 130 }, 1, { pointerId: 1 });
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

    describe('right-click context menu', () => {
      /** One calibration point per pixel, as `seed` does for the drag tests. */
      function seed(...pixels: readonly Point[]) {
        archive.getManifest().layout.calibration.points = pixels.map((px, i) => ({
          px,
          world: { x: i * 10, y: 0, z: 0 },
        }));
      }

      it('opens on the object under the cursor, carrying delete', async () => {
        seed({ x: 100, y: 100 });
        const el = await mount();

        await rightClickAt(el, { x: 103, y: 101 }, { x: 640, y: 400 });

        expect(menuOf(el).open).to.be.true;
        expect(menuItems(el)).to.deep.equal(['delete']);
        // At the cursor, in the client frame the right-click was reported in.
        expect(menuOf(el).style.getPropertyValue('--menu-x')).to.equal('640px');
        expect(menuOf(el).style.getPropertyValue('--menu-y')).to.equal('400px');
      });

      it('opens nothing on empty image', async () => {
        seed({ x: 100, y: 100 });
        const el = await mount();

        await rightClickAt(el, { x: 500, y: 500 });

        expect(menuOf(el).open).to.be.false;
      });

      it('suppresses the browser menu inside the viewer, hit or miss', async () => {
        // Right-click is an editor gesture wherever it lands in the viewer —
        // idle on empty image is the one case that does nothing, and once a
        // chain can be live the same press ends it. Outside the viewer nothing
        // listens, so the browser's own menu is untouched there.
        seed({ x: 100, y: 100 });
        const el = await mount();

        expect((await rightClickAt(el, { x: 100, y: 100 })).defaultPrevented).to.be.true;
        expect((await rightClickAt(el, { x: 500, y: 500 })).defaultPrevented).to.be.true;
      });

      it('deletes the point as one layout entry, and undo restores it exactly', async () => {
        seed({ x: 100, y: 100 }, { x: 400, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);
        const before = structuredClone(points());

        await rightClickAt(el, { x: 400, y: 100 });
        await choose(el, 'delete');

        expect(points()).to.deep.equal([before[0]]);
        expect(history.size).to.equal(1);
        expect(history.undoLabel).to.contain('calibration');

        const entry = await history.undo();
        expect(entry!.target).to.deep.equal({ kind: 'layout' });
        expect(points()).to.deep.equal(before);

        await history.redo();
        expect(points()).to.deep.equal([before[0]]);
      });

      it('takes the DPT readout with it', async () => {
        seed({ x: 0, y: 0 }, { x: 100, y: 0 });
        const el = await mount();
        expect(el.shadowRoot!.querySelector('.dpt-bar')!.textContent).to.contain('DPT 89.7');

        await rightClickAt(el, { x: 100, y: 0 });
        await choose(el, 'delete');

        expect(el.shadowRoot!.querySelector('.dpt-bar')!.textContent).to.contain('Not calibrated');
      });

      it('closes the menu once a row is chosen', async () => {
        seed({ x: 100, y: 100 });
        const el = await mount();

        await rightClickAt(el, { x: 100, y: 100 });
        await choose(el, 'delete');

        expect(menuOf(el).open).to.be.false;
      });

      it('drops a delete whose point moved underneath the open menu', async () => {
        // Same staleness as the dialog: an undo landing while the menu is up can
        // slide the index onto a point the menu was never opened on, and points
        // carry no id to tell them apart.
        const layout = archive.getManifest().layout;
        seed({ x: 100, y: 100 }, { x: 400, y: 100 });
        const el = await mount();

        await rightClickAt(el, { x: 400, y: 100 });
        layout.calibration = { points: [layout.calibration.points[1]] };
        await choose(el, 'delete');

        expect(points()).to.deep.equal([
          { px: { x: 400, y: 100 }, world: { x: 10, y: 0, z: 0 } },
        ]);
      });

      it('does not run the click path for the right button', async () => {
        // A right-click arrives through the same pointer events as a left one.
        // Without the button filter the press that opens the menu also places
        // or edits a point, and the dialog comes up behind the menu.
        seed({ x: 100, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);
        const show = stubDialog(el);

        gesture(el, 'rr-pointer-down', { x: 100, y: 100 }, 1, { button: 2 });
        gesture(el, 'rr-pointer-up', { x: 100, y: 100 }, 1, { button: 2 });
        await flush();
        await el.updateComplete;

        expect(show).not.toHaveBeenCalled();
        expect(history.size).to.equal(0);
      });

      it('leaves a live drag alone when a secondary button is released', async () => {
        // One `pointerId` covers every mouse button, so the right button's
        // release carries the left drag's id. Ending the drag on it would
        // commit a gesture the user has not finished.
        seed({ x: 100, y: 100 });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mount(history);

        gesture(el, 'rr-pointer-down', { x: 100, y: 100 }, 1);
        gesture(el, 'rr-pointer-move', { x: 300, y: 300 }, 1);
        gesture(el, 'rr-pointer-up', { x: 300, y: 300 }, 1, { button: 2 });
        await flush();
        expect(history.size).to.equal(0);

        gesture(el, 'rr-pointer-move', { x: 350, y: 350 }, 1);
        gesture(el, 'rr-pointer-up', { x: 350, y: 350 }, 1);
        await flush();
        await el.updateComplete;

        expect(points()[0].px).to.deep.equal({ x: 350, y: 350 });
        expect(history.size).to.equal(1);
      });

      it('ignores a right-click during a drag', async () => {
        seed({ x: 100, y: 100 });
        const el = await mount();

        gesture(el, 'rr-pointer-down', { x: 100, y: 100 }, 1);
        gesture(el, 'rr-pointer-move', { x: 300, y: 300 }, 1);
        await flush();
        await rightClickAt(el, { x: 300, y: 300 });

        expect(menuOf(el).open).to.be.false;
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

  /**
   * Two calibration points at a nonzero separation — exactly "DPT resolves",
   * which is the whole of the gate.
   */
  function calibrate() {
    archive.getManifest().layout.calibration.points = [
      { px: { x: 0, y: 0 }, world: { x: 0, y: 0, z: 0 } },
      { px: { x: 100, y: 0 }, world: { x: 10, y: 0, z: 0 } },
    ];
  }

  function paletteOf(el: RREditorView): RRToolPalette {
    return el.shadowRoot!.querySelector('rr-tool-palette')!;
  }

  /** A palette selection, shaped the way `rr-tool-palette` reports one. */
  async function selectTool(el: RREditorView, tool: EditorTool) {
    paletteOf(el).dispatchEvent(
      new CustomEvent('rr-tool-select', { detail: { tool }, bubbles: true, composed: true })
    );
    await el.updateComplete;
  }

  describe('the tool palette and the calibration gate', () => {
    it('offers the palette once an archive is open', async () => {
      const el = await mount();
      expect(paletteOf(el)).to.exist;
    });

    it('opens an uncalibrated archive in calibration mode, with the rest gated', async () => {
      const el = await mount();

      expect(paletteOf(el).tool).to.equal('calibration');
      expect(paletteOf(el).calibrated).to.be.false;
    });

    it('enables the labeling tools the moment a second point resolves DPT', async () => {
      const el = await mount();

      await clickAt(el, { x: 0, y: 0 });
      await commit(el, { x: 0, y: 0, z: 0 });
      expect(paletteOf(el).calibrated).to.be.false;

      await clickAt(el, { x: 100, y: 0 });
      await commit(el, { x: 10, y: 0, z: 0 });

      // Existence, not completion: two points at a nonzero separation is it.
      expect(paletteOf(el).calibrated).to.be.true;
    });

    it('leaves the tools gated for two points at the same position', async () => {
      // A zero separation resolves no scale, so it is not calibration.
      archive.getManifest().layout.calibration.points = [
        { px: { x: 50, y: 50 }, world: { x: 0, y: 0, z: 0 } },
        { px: { x: 50, y: 50 }, world: { x: 0, y: 0, z: 0 } },
      ];
      const el = await mount();

      expect(paletteOf(el).calibrated).to.be.false;
    });

    it('drops a gated tool back to calibration when the DPT stops resolving', async () => {
      // The DPT can vanish through an undo, which no handler here sees — so the
      // demotion is enforced on render rather than at the delete.
      calibrate();
      const el = await mount();
      await selectTool(el, 'sensor');
      expect(paletteOf(el).tool).to.equal('sensor');

      await rightClickAt(el, { x: 100, y: 0 });
      await choose(el, 'delete');

      expect(paletteOf(el).calibrated).to.be.false;
      expect(paletteOf(el).tool).to.equal('calibration');
      // And a click means calibrate again, rather than silently placing nothing.
      const show = stubDialog(el);
      await clickAt(el, { x: 400, y: 400 });
      expect(show).toHaveBeenCalledOnce();
      expect(sensors()).to.have.length(0);
    });

    it('re-enters calibration mode for the next archive', async () => {
      calibrate();
      const el = await mount();
      await selectTool(el, 'sensor');

      const next = new R49Archive();
      next.setManifest({
        version: 4,
        layout: { name: 'Next', scale: 'N', calibration: { points: [] }, sensors: [] },
        camera: { resolution: { width: 100, height: 100 } },
        images: [],
      });
      vi.spyOn(next, 'getImage').mockResolvedValue(new Uint8Array());
      el.archive = next;
      await el.updateComplete;
      await flush();
      await el.updateComplete;

      expect(paletteOf(el).tool).to.equal('calibration');
    });
  });

  describe('sensor authoring', () => {
    /** A calibrated archive with the sensor tool live. */
    async function mountWithSensorTool(history?: EditHistory) {
      calibrate();
      const el = await mount(history);
      await selectTool(el, 'sensor');
      return el;
    }

    /** What the sensor dialog emits when the user confirms a name. */
    async function commitName(el: RREditorView, name: string | null) {
      el.shadowRoot!.querySelector('rr-sensor-dialog')!.dispatchEvent(
        new CustomEvent('rr-sensor-name-commit', {
          detail: { name },
          bubbles: true,
          composed: true,
        })
      );
      await flush();
      await el.updateComplete;
    }

    it('places a sensor at the clicked pixel, unnamed and with a snowflake id', async () => {
      const el = await mountWithSensorTool();

      await clickAt(el, { x: 320.4, y: 240.6 });

      expect(sensors()).to.have.length(1);
      const [sensor] = sensors();
      // The click names a pixel, so the stored position is a whole one.
      expect(sensor.x).to.equal(320);
      expect(sensor.y).to.equal(241);
      // Never auto-generated: consumers key on `id`, and a made-up name would be
      // indistinguishable from one a human chose.
      expect(sensor.name).to.be.undefined;
      expect(sensor.id).to.have.length(11);
    });

    it('gives every sensor its own id', async () => {
      const el = await mountWithSensorTool();

      await clickAt(el, { x: 100, y: 400 });
      await clickAt(el, { x: 200, y: 400 });
      await clickAt(el, { x: 300, y: 400 });

      expect(new Set(sensors().map(s => s.id)).size).to.equal(3);
    });

    it('records one layout entry per sensor, and undo reverses it', async () => {
      const history = new EditHistory();
      history.attach(archive);
      const el = await mountWithSensorTool(history);

      await clickAt(el, { x: 320, y: 240 });

      expect(history.size).to.equal(1);
      expect(history.undoLabel).to.contain('sensor');

      const entry = await history.undo();
      expect(entry!.target).to.deep.equal({ kind: 'layout' });
      expect(sensors()).to.have.length(0);

      await history.redo();
      expect(sensors()).to.have.length(1);
    });

    it('shows the layout\'s sensors on the viewer', async () => {
      const el = await mountWithSensorTool();
      await clickAt(el, { x: 320, y: 240 });

      expect(el.shadowRoot!.querySelector('rr-viewer')!.sensors).to.deep.equal(sensors());
    });

    it('hands the viewer the DPT, which is what sizes a sensor', async () => {
      // A sensor is drawn one track width across, and a track width in image
      // pixels *is* DPT — so the viewer needs the number, not just the points.
      const el = await mountWithSensorTool();
      const viewer = el.shadowRoot!.querySelector('rr-viewer')!;
      expect(viewer.dpt).to.equal(getDPT(archive.getManifest()));

      // And it follows the calibration live, mid-session.
      await drag(el, [
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ]);
      expect(viewer.dpt).to.equal(getDPT(archive.getManifest()));
    });

    it('asks no dialog on placement — a sensor with no name is complete', async () => {
      const el = await mountWithSensorTool();
      const show = stubSensorDialog(el);

      await clickAt(el, { x: 320, y: 240 });

      expect(show).not.toHaveBeenCalled();
      expect(sensors()).to.have.length(1);
    });

    it('names a sensor from the context menu', async () => {
      const history = new EditHistory();
      history.attach(archive);
      const el = await mountWithSensorTool(history);
      await clickAt(el, { x: 320, y: 240 });
      const show = stubSensorDialog(el);

      await rightClickAt(el, { x: 320, y: 240 });
      expect(menuItems(el)).to.deep.equal(['name', 'delete']);

      await choose(el, 'name');
      expect(show).toHaveBeenCalledWith(null, { id: sensors()[0].id });

      await commitName(el, 'Yard throat');
      expect(sensors()[0].name).to.equal('Yard throat');
      expect(history.undoLabel).to.contain('sensor');

      await history.undo();
      expect(sensors()[0].name).to.be.undefined;
    });

    it('names a sensor from a click on it, whatever the tool is', async () => {
      const el = await mountWithSensorTool();
      await clickAt(el, { x: 320, y: 240 });
      await selectTool(el, 'calibration');
      const show = stubSensorDialog(el);
      const calibrationShow = stubDialog(el);

      await clickAt(el, { x: 322, y: 241 });

      // The object under the cursor is edited; the calibration tool must not
      // stack a point on top of the sensor the user was aiming at.
      expect(show).toHaveBeenCalledOnce();
      expect(calibrationShow).not.toHaveBeenCalled();
      expect(points()).to.have.length(2);
    });

    it('removes the name when the field comes back blank', async () => {
      const el = await mountWithSensorTool();
      await clickAt(el, { x: 320, y: 240 });

      await rightClickAt(el, { x: 320, y: 240 });
      await choose(el, 'name');
      await commitName(el, 'Yard throat');

      await rightClickAt(el, { x: 320, y: 240 });
      await choose(el, 'name');
      await commitName(el, null);

      // Absent, not empty: a stored `""` would be a name that displays as
      // nothing while still counting as one.
      expect('name' in sensors()[0]).to.be.false;
    });

    it('records nothing for a name that did not change', async () => {
      const history = new EditHistory();
      history.attach(archive);
      const el = await mountWithSensorTool(history);
      await clickAt(el, { x: 320, y: 240 });
      await rightClickAt(el, { x: 320, y: 240 });
      await choose(el, 'name');
      await commitName(el, 'Yard throat');
      const size = history.size;

      await rightClickAt(el, { x: 320, y: 240 });
      await choose(el, 'name');
      await commitName(el, 'Yard throat');

      expect(history.size).to.equal(size);
    });

    it('grabs a sensor anywhere on the symbol it is drawn as', async () => {
      // The archive calibrates to DPT 89.7, so the diamond is ~90 image px
      // across — far wider than the pointer's own 14 screen px of reach, and a
      // symbol you can see but cannot click reads as a bug.
      const el = await mountWithSensorTool();
      await clickAt(el, { x: 600, y: 400 });
      const show = stubSensorDialog(el);

      // 40 px off centre: inside the diamond, outside the pointer radius.
      await clickAt(el, { x: 640, y: 400 });

      expect(show).toHaveBeenCalledOnce();
      expect(sensors()).to.have.length(1);
    });

    it('drags a sensor, one entry per gesture, targeting layout', async () => {
      const history = new EditHistory();
      history.attach(archive);
      const el = await mountWithSensorTool(history);
      await clickAt(el, { x: 320, y: 240 });
      const placed = history.size;

      // Pressed three pixels off-centre: the sensor translates by the delta
      // rather than teleporting under the cursor.
      await drag(el, [
        { x: 323, y: 242 },
        { x: 400, y: 300 },
        { x: 423, y: 342 },
      ]);

      expect(sensors()[0]).to.include({ x: 420, y: 340 });
      expect(history.size).to.equal(placed + 1);
      expect(history.undoLabel).to.contain('sensor');

      const entry = await history.undo();
      expect(entry!.target).to.deep.equal({ kind: 'layout' });
      expect(sensors()[0]).to.include({ x: 320, y: 240 });
    });

    it('keeps a dragged sensor\'s id and name', async () => {
      const el = await mountWithSensorTool();
      await clickAt(el, { x: 320, y: 240 });
      await rightClickAt(el, { x: 320, y: 240 });
      await choose(el, 'name');
      await commitName(el, 'Yard throat');
      const before = sensors()[0].id;

      await drag(el, [
        { x: 320, y: 240 },
        { x: 500, y: 400 },
      ]);

      expect(sensors()[0].id).to.equal(before);
      expect(sensors()[0].name).to.equal('Yard throat');
    });

    it('deletes a sensor from the context menu, and undo restores it whole', async () => {
      const history = new EditHistory();
      history.attach(archive);
      const el = await mountWithSensorTool(history);
      await clickAt(el, { x: 320, y: 240 });
      await clickAt(el, { x: 500, y: 240 });
      const before = structuredClone(sensors());

      await rightClickAt(el, { x: 320, y: 240 });
      await choose(el, 'delete');

      expect(sensors()).to.deep.equal([before[1]]);
      expect(history.undoLabel).to.contain('sensor');

      const entry = await history.undo();
      expect(entry!.target).to.deep.equal({ kind: 'layout' });
      expect(sensors()).to.deep.equal(before);
    });

    it('leaves the calibration points alone when a sensor is written', async () => {
      // `_writeLayout` takes only what changed, so a sensor edit cannot rewrite
      // the calibration beside it.
      const el = await mountWithSensorTool();
      const before = structuredClone(points());

      await clickAt(el, { x: 320, y: 240 });
      await drag(el, [
        { x: 320, y: 240 },
        { x: 400, y: 300 },
      ]);

      expect(points()).to.deep.equal(before);
    });

    it('grabs whichever object is nearest, sensor or calibration point', async () => {
      const el = await mountWithSensorTool();
      await clickAt(el, { x: 320, y: 240 });

      // The calibration point at (100, 0) is what this drag grabs, even with the
      // sensor tool live: a drag moves what is under it, never what is selected.
      await drag(el, [
        { x: 100, y: 0 },
        { x: 150, y: 50 },
      ]);

      expect(points()[1].px).to.deep.equal({ x: 150, y: 50 });
      expect(sensors()[0]).to.include({ x: 320, y: 240 });
    });

    it('survives a save and reopen', async () => {
      const el = await mountWithSensorTool();
      await clickAt(el, { x: 320, y: 240 });
      await rightClickAt(el, { x: 320, y: 240 });
      await choose(el, 'name');
      await commitName(el, 'Yard throat');

      const reopened = await R49Archive.load(await archive.export());

      expect(reopened.getManifest().layout.sensors).to.deep.equal(sensors());
    });
  });

  describe('car authoring', () => {
    /** A calibrated archive with the car tool live. */
    async function mountWithCarTool(history?: EditHistory) {
      calibrate();
      const el = await mount(history);
      await selectTool(el, 'car');
      return el;
    }

    /** A hand-drawn car — the only kind this editor authors. */
    type HumanCar = Extract<CarLabel, { provenance: 'human' }>;

    /** The current image's labels — cars are per image. */
    function cars(index = 0): CarLabel[] {
      return archive.getManifest().images[index].labels;
    }

    /** Adds a second image, so the per-image rules have something to switch to. */
    function addSecondImage() {
      archive.getManifest().images.push({
        filename: 'img2.jpg',
        labeled_complete: false,
        labels: [],
      });
    }

    /** Selects an image the way `rr-thumbnail-bar` reports one. */
    async function selectImage(el: RREditorView, index: number) {
      el.shadowRoot!.querySelector('rr-thumbnail-bar')!.dispatchEvent(
        new CustomEvent('rr-image-select', { detail: { index }, bubbles: true, composed: true })
      );
      await el.updateComplete;
    }

    it('creates a car from two clicks on the visible ends', async () => {
      const el = await mountWithCarTool();

      await clickAt(el, { x: 200.4, y: 300.6 });
      // The first click names one end and writes nothing.
      expect(cars()).to.have.length(0);

      await clickAt(el, { x: 500, y: 300 });

      expect(cars()).to.have.length(1);
      // The click names a pixel, so both ends are whole ones.
      expect(cars()[0].p0).to.deep.equal({ x: 200, y: 301 });
      expect(cars()[0].p1).to.deep.equal({ x: 500, y: 300 });
    });

    it('creates it as a human-authored car at the taxonomy root', async () => {
      const el = await mountWithCarTool();
      await clickAt(el, { x: 200, y: 300 });
      await clickAt(el, { x: 500, y: 300 });

      const [car] = cars();
      expect(car.class).to.equal('stock');
      expect(car.provenance).to.equal('human');
      // The schema forbids the key on a human label; a default of `human` on
      // model output is the loop provenance exists to make measurable.
      expect('proposed_by' in car).to.be.false;
      expect(car.id).to.have.length(11);
    });

    it('gives every car its own id', async () => {
      const el = await mountWithCarTool();
      for (const y of [100, 200, 300]) {
        await clickAt(el, { x: 100, y });
        await clickAt(el, { x: 400, y });
      }

      expect(cars()).to.have.length(3);
      expect(new Set(cars().map(c => c.id)).size).to.equal(3);
    });

    it('records one entry per car, targeting the image it is on', async () => {
      const history = new EditHistory();
      history.attach(archive);
      const el = await mountWithCarTool(history);

      await clickAt(el, { x: 200, y: 300 });
      expect(history.size).to.equal(0);

      await clickAt(el, { x: 500, y: 300 });

      expect(history.size).to.equal(1);
      expect(history.undoLabel).to.contain('car');

      const entry = await history.undo();
      expect(entry!.target).to.deep.equal({ kind: 'image', filename: 'img1.jpg' });
      expect(cars()).to.have.length(0);

      await history.redo();
      expect(cars()).to.have.length(1);
    });

    it('hands the cars and the DPT to the viewer', async () => {
      // The width rectangle is derived from DPT, never stored, so the viewer
      // needs the number as well as the spans.
      const el = await mountWithCarTool();
      await clickAt(el, { x: 200, y: 300 });
      await clickAt(el, { x: 500, y: 300 });

      const viewer = el.shadowRoot!.querySelector('rr-viewer')!;
      expect(viewer.cars).to.deep.equal(cars());
      expect(viewer.dpt).to.equal(getDPT(archive.getManifest()));
    });

    it('writes nothing for a placement the user abandons', async () => {
      const history = new EditHistory();
      history.attach(archive);
      const el = await mountWithCarTool(history);

      await clickAt(el, { x: 200, y: 300 });
      await selectTool(el, 'sensor');

      expect(cars()).to.have.length(0);
      expect(history.size).to.equal(0);

      // And the anchor is gone: the next click is the sensor tool's, not the
      // second half of a car the user stopped drawing.
      await clickAt(el, { x: 500, y: 300 });
      expect(cars()).to.have.length(0);
      expect(sensors()).to.have.length(1);
    });

    it('ends a placement on right-click, opening no menu', async () => {
      // The same gesture that will end a chain (#33). Nothing was written, so
      // nothing is undone.
      const history = new EditHistory();
      history.attach(archive);
      const el = await mountWithCarTool(history);

      await clickAt(el, { x: 200, y: 300 });
      await rightClickAt(el, { x: 500, y: 300 });

      expect(menuOf(el).open).to.be.false;
      expect(cars()).to.have.length(0);
      expect(history.size).to.equal(0);

      // The next click starts a new car rather than completing the old anchor.
      await clickAt(el, { x: 600, y: 600 });
      await clickAt(el, { x: 800, y: 600 });
      expect(cars()[0].p0).to.deep.equal({ x: 600, y: 600 });
    });

    it('completes the car even when the second click lands on another object', async () => {
      // A placement in progress outranks the object under the cursor: the
      // second click is what gives the car its other end, and interpreting it
      // as an edit would strand the anchor.
      const el = await mountWithCarTool();
      const show = stubDialog(el);

      await clickAt(el, { x: 200, y: 300 });
      // (100, 0) is a calibration point.
      await clickAt(el, { x: 100, y: 0 });

      expect(cars()).to.have.length(1);
      expect(cars()[0].p1).to.deep.equal({ x: 100, y: 0 });
      expect(show).not.toHaveBeenCalled();
    });

    it('starts no car from a click on an existing car end', async () => {
      // The object under the cursor wins when no placement is live, and a car
      // end has nothing a click can edit — so the click does nothing at all
      // rather than stacking a second label on the one being aimed at.
      // Abutting cars are authored by **chaining** (#33), not by clicking a
      // free anchor onto an existing end.
      const el = await mountWithCarTool();
      await clickAt(el, { x: 100, y: 100 });
      await clickAt(el, { x: 400, y: 100 });

      await clickAt(el, { x: 400, y: 100 });
      await clickAt(el, { x: 700, y: 100 });

      expect(cars()).to.have.length(1);
    });

    describe('dragging an endpoint', () => {
      /** One car spanning the frame, authored by hand rather than by click. */
      function seedCar(over: Partial<HumanCar> = {}): HumanCar {
        const car: HumanCar = {
          id: 'C1abcdefghi',
          class: 'stock',
          provenance: 'human',
          p0: { x: 100, y: 100 },
          p1: { x: 400, y: 100 },
          ...over,
        };
        archive.getManifest().images[0].labels.push(car);
        return car;
      }

      it('moves the end that was grabbed, keeping the grab offset', async () => {
        seedCar();
        const el = await mountWithCarTool();

        // Pressed three pixels off the end: it translates by the delta rather
        // than teleporting under the cursor.
        await drag(el, [
          { x: 103, y: 102 },
          { x: 200, y: 150 },
          { x: 203, y: 202 },
        ]);

        expect(cars()[0].p0).to.deep.equal({ x: 200, y: 200 });
        expect(cars()[0].p1).to.deep.equal({ x: 400, y: 100 });
      });

      it('records one entry per gesture, targeting the image', async () => {
        seedCar();
        const history = new EditHistory();
        history.attach(archive);
        const el = await mountWithCarTool(history);

        const path: Point[] = [{ x: 400, y: 100 }];
        for (let i = 1; i <= 100; i++) path.push({ x: 400 + i, y: 100 });
        await drag(el, path);

        expect(cars()[0].p1).to.deep.equal({ x: 500, y: 100 });
        expect(history.size).to.equal(1);
        expect(history.undoLabel).to.contain('car');

        const entry = await history.undo();
        expect(entry!.target).to.deep.equal({ kind: 'image', filename: 'img1.jpg' });
        expect(cars()[0].p1).to.deep.equal({ x: 400, y: 100 });
      });

      it('keeps the label whole — id, class and provenance', async () => {
        seedCar();
        const el = await mountWithCarTool();

        await drag(el, [
          { x: 100, y: 100 },
          { x: 150, y: 160 },
        ]);

        expect(cars()[0]).to.deep.equal({
          id: 'C1abcdefghi',
          class: 'stock',
          provenance: 'human',
          p0: { x: 150, y: 160 },
          p1: { x: 400, y: 100 },
        });
      });

      it('records nothing for a drag returned to its origin', async () => {
        seedCar();
        const history = new EditHistory();
        history.attach(archive);
        const el = await mountWithCarTool(history);

        await drag(el, [
          { x: 100, y: 100 },
          { x: 300, y: 300 },
          { x: 100, y: 100 },
        ]);

        expect(history.size).to.equal(0);
        expect(cars()[0].p0).to.deep.equal({ x: 100, y: 100 });
      });

      it('leaves the layout alone, and the calibration points with it', async () => {
        seedCar();
        const el = await mountWithCarTool();
        const before = structuredClone(points());

        await drag(el, [
          { x: 100, y: 100 },
          { x: 250, y: 250 },
        ]);

        expect(points()).to.deep.equal(before);
      });

      it('moves both cars of a coupling, as one entry', async () => {
        // A coupling is exact coincidence and nothing about it is stored, so
        // the shared handle has to move both ends or the train comes apart.
        seedCar();
        seedCar({ id: 'C2abcdefghi', p0: { x: 400, y: 100 }, p1: { x: 700, y: 100 } });
        const history = new EditHistory();
        history.attach(archive);
        const el = await mountWithCarTool(history);

        await drag(el, [
          { x: 400, y: 100 },
          { x: 450, y: 200 },
        ]);

        expect(cars()[0].p1).to.deep.equal({ x: 450, y: 200 });
        expect(cars()[1].p0).to.deep.equal({ x: 450, y: 200 });
        expect(history.size).to.equal(1);
      });

      it('addresses the car by id across a history apply', async () => {
        // Applying a snapshot replaces the objects wholesale: anything holding
        // an object reference would be pointing at a stale car here.
        const history = new EditHistory();
        history.attach(archive);
        const el = await mountWithCarTool(history);
        await clickAt(el, { x: 100, y: 100 });
        await clickAt(el, { x: 400, y: 100 });
        const id = cars()[0].id;

        await history.undo();
        await history.redo();
        await el.updateComplete;

        await drag(el, [
          { x: 400, y: 100 },
          { x: 500, y: 100 },
        ]);

        expect(cars()).to.have.length(1);
        expect(cars()[0].id).to.equal(id);
        expect(cars()[0].p1).to.deep.equal({ x: 500, y: 100 });
      });
    });

    describe('deleting', () => {
      async function mountWithTwoCars(history?: EditHistory) {
        const el = await mountWithCarTool(history);
        await clickAt(el, { x: 100, y: 100 });
        await clickAt(el, { x: 400, y: 100 });
        await clickAt(el, { x: 100, y: 500 });
        await clickAt(el, { x: 400, y: 500 });
        return el;
      }

      it('offers delete on a car end', async () => {
        const el = await mountWithTwoCars();

        await rightClickAt(el, { x: 402, y: 101 });

        expect(menuOf(el).open).to.be.true;
        expect(menuItems(el)).to.deep.equal(['delete']);
      });

      it('deletes that car and leaves the others untouched', async () => {
        const history = new EditHistory();
        history.attach(archive);
        const el = await mountWithTwoCars(history);
        const before = structuredClone(cars());

        await rightClickAt(el, { x: 100, y: 100 });
        await choose(el, 'delete');

        expect(cars()).to.deep.equal([before[1]]);
        expect(history.undoLabel).to.contain('car');
      });

      it('undo restores it with the same id, and the same everything else', async () => {
        const history = new EditHistory();
        history.attach(archive);
        const el = await mountWithTwoCars(history);
        const before = structuredClone(cars());

        await rightClickAt(el, { x: 100, y: 100 });
        await choose(el, 'delete');

        const entry = await history.undo();
        expect(entry!.target).to.deep.equal({ kind: 'image', filename: 'img1.jpg' });
        expect(cars()).to.deep.equal(before);

        await history.redo();
        expect(cars()).to.deep.equal([before[1]]);
      });

      it('drops a delete whose car went away underneath the open menu', async () => {
        const el = await mountWithTwoCars();
        const before = structuredClone(cars());

        await rightClickAt(el, { x: 100, y: 100 });
        // An undo landing while the menu is up.
        archive.getManifest().images[0].labels = [before[1]];
        await choose(el, 'delete');

        expect(cars()).to.deep.equal([before[1]]);
      });
    });

    describe('per image', () => {
      it('shows the selected image\'s cars, and records nothing for the switch', async () => {
        addSecondImage();
        const history = new EditHistory();
        history.attach(archive);
        const el = await mountWithCarTool(history);

        await clickAt(el, { x: 100, y: 100 });
        await clickAt(el, { x: 400, y: 100 });
        const placed = history.size;

        await selectImage(el, 1);

        // Selection is view state: nothing in the manifest changed.
        expect(history.size).to.equal(placed);
        expect(el.shadowRoot!.querySelector('rr-viewer')!.cars).to.deep.equal([]);

        await clickAt(el, { x: 200, y: 200 });
        await clickAt(el, { x: 500, y: 200 });

        // Labels are not carried between images.
        expect(cars(0)).to.have.length(1);
        expect(cars(1)).to.have.length(1);
        expect(cars(1)[0].p0).to.deep.equal({ x: 200, y: 200 });

        await selectImage(el, 0);
        expect(el.shadowRoot!.querySelector('rr-viewer')!.cars).to.deep.equal(cars(0));
      });

      it('abandons a placement when the image changes', async () => {
        // The anchor is a pixel on the image it was clicked on.
        addSecondImage();
        const el = await mountWithCarTool();

        await clickAt(el, { x: 100, y: 100 });
        await selectImage(el, 1);
        await clickAt(el, { x: 400, y: 100 });

        expect(cars(0)).to.have.length(0);
        expect(cars(1)).to.have.length(0);
      });

      it('abandons a placement when an undo reveals another image', async () => {
        // `rr-app` calls syncFromArchive() after an undo whose entry targets a
        // different image. The anchor would otherwise survive the jump and the
        // next click would write a car with one end from each frame.
        addSecondImage();
        const el = await mountWithCarTool();

        await selectImage(el, 1);
        await clickAt(el, { x: 100, y: 100 });
        await el.syncFromArchive('img1.jpg');
        await el.updateComplete;

        await clickAt(el, { x: 400, y: 100 });

        expect(cars(0)).to.have.length(0);
        expect(cars(1)).to.have.length(0);
      });

      it('grabs only the cars of the image on screen', async () => {
        addSecondImage();
        const el = await mountWithCarTool();
        await clickAt(el, { x: 100, y: 100 });
        await clickAt(el, { x: 400, y: 100 });
        const before = structuredClone(cars(0));

        await selectImage(el, 1);
        await drag(el, [
          { x: 100, y: 100 },
          { x: 300, y: 300 },
        ]);

        expect(cars(0)).to.deep.equal(before);
      });
    });

    it('round-trips through a save and reopen', async () => {
      const el = await mountWithCarTool();
      await clickAt(el, { x: 100, y: 100 });
      await clickAt(el, { x: 400, y: 100 });
      await clickAt(el, { x: 100, y: 500 });
      await clickAt(el, { x: 400, y: 500 });

      // Reopening validates against the v4 schema — a label the schema refused
      // would throw here rather than compare unequal.
      const reopened = await R49Archive.load(await archive.export());

      expect(reopened.getManifest().images[0].labels).to.deep.equal(cars());
      expect(reopened.getManifest().images[0].labels).to.have.length(2);
    });

    it('authors nothing while the gate is closed', async () => {
      // The car tool cannot be live without a DPT — the palette disables it and
      // `willUpdate` demotes it — so a click means calibration instead.
      const el = await mount();
      await selectTool(el, 'car');
      const show = stubDialog(el);

      await clickAt(el, { x: 100, y: 100 });
      await clickAt(el, { x: 400, y: 100 });

      expect(paletteOf(el).tool).to.equal('calibration');
      expect(cars()).to.have.length(0);
      expect(show).toHaveBeenCalled();
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
