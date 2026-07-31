import { describe, it, expect } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import '../src/rr-context-menu.js';
import { RRContextMenu } from '../src/rr-context-menu.js';
import type { ContextMenuSelectDetail } from '../src/rr-context-menu.js';

/** The menu's rows, as `[id, label]` pairs read back out of the DOM. */
function rows(el: RRContextMenu): [string, string][] {
  return [...el.shadowRoot!.querySelectorAll('sl-menu-item')].map(item => [
    item.getAttribute('value') ?? '',
    item.textContent!.trim(),
  ]);
}

/** Selects a row the way `sl-menu` reports one. */
function select(el: RRContextMenu, id: string) {
  const item = el.shadowRoot!.querySelector(`sl-menu-item[value="${id}"]`)!;
  el.shadowRoot!.querySelector('sl-menu')!.dispatchEvent(
    new CustomEvent('sl-select', { detail: { item }, bubbles: true, composed: true })
  );
}

const DELETE = { id: 'delete', label: 'Delete calibration point' };

describe('rr-context-menu', () => {
  async function mount() {
    return await fixture<RRContextMenu>(html`<rr-context-menu></rr-context-menu>`);
  }

  it('is defined', () => {
    expect(document.createElement('rr-context-menu')).to.be.instanceOf(RRContextMenu);
  });

  it('renders nothing until it is shown', async () => {
    const el = await mount();
    expect(el.open).to.be.false;
    expect(el.shadowRoot!.querySelector('sl-menu')).to.not.exist;
  });

  it('renders the rows it was given, at the cursor', async () => {
    const el = await mount();
    await el.show({ x: 120, y: 60 }, [DELETE]);

    expect(el.open).to.be.true;
    expect(rows(el)).to.deep.equal([['delete', 'Delete calibration point']]);
    expect(el.style.getPropertyValue('--menu-x')).to.equal('120px');
    expect(el.style.getPropertyValue('--menu-y')).to.equal('60px');
  });

  it('reopens at the new position with the new rows', async () => {
    const el = await mount();
    await el.show({ x: 10, y: 10 }, [DELETE]);
    await el.show({ x: 300, y: 200 }, [{ id: 'other', label: 'Something else' }]);

    expect(rows(el)).to.deep.equal([['other', 'Something else']]);
    expect(el.style.getPropertyValue('--menu-x')).to.equal('300px');
  });

  it('reports the selected row by id, and closes', async () => {
    const el = await mount();
    const selected: string[] = [];
    el.addEventListener('rr-context-menu-select', (e: CustomEvent<ContextMenuSelectDetail>) =>
      selected.push(e.detail.id)
    );

    await el.show({ x: 0, y: 0 }, [DELETE]);
    select(el, 'delete');
    await el.updateComplete;

    expect(selected).to.deep.equal(['delete']);
    expect(el.open).to.be.false;
  });

  it('dismisses on a press outside it', async () => {
    const el = await mount();
    await el.show({ x: 0, y: 0 }, [DELETE]);

    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, composed: true })
    );
    await el.updateComplete;

    expect(el.open).to.be.false;
  });

  it('swallows the dismissing press, so it authors nothing behind the menu', async () => {
    // The press lands on the labeling surface, where the editor would read it
    // as a click and place a point behind the menu the user was closing.
    const el = await mount();
    await el.show({ x: 0, y: 0 }, [DELETE]);

    const surface = document.createElement('div');
    document.body.append(surface);
    let sawPress = false;
    surface.addEventListener('pointerdown', () => {
      sawPress = true;
    });

    const press = new MouseEvent('pointerdown', {
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    surface.dispatchEvent(press);
    await el.updateComplete;
    surface.remove();

    expect(sawPress).to.be.false;
    expect(press.defaultPrevented).to.be.true;
    expect(el.open).to.be.false;
  });

  it('stays open for a press on itself, so a row can be clicked', async () => {
    const el = await mount();
    await el.show({ x: 0, y: 0 }, [DELETE]);

    el.shadowRoot!
      .querySelector('sl-menu-item')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    await el.updateComplete;

    expect(el.open).to.be.true;
  });

  it('dismisses on Escape', async () => {
    const el = await mount();
    await el.show({ x: 0, y: 0 }, [DELETE]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;

    expect(el.open).to.be.false;
  });

  it('leaves other keys alone', async () => {
    const el = await mount();
    await el.show({ x: 0, y: 0 }, [DELETE]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await el.updateComplete;

    expect(el.open).to.be.true;
  });

  it('stops listening once it is gone', async () => {
    // The listeners are on the document, so an element removed while open would
    // otherwise keep answering presses for the rest of the session.
    const el = await mount();
    await el.show({ x: 0, y: 0 }, [DELETE]);
    el.remove();

    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    ).to.not.throw();
    expect(el.open).to.be.false;
  });
});
