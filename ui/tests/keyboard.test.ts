import { describe, it, expect } from 'vitest';
import { isInsideOpenDialog, isTypingTarget } from '../src/keyboard.js';

/**
 * Both predicates read `composedPath()`, which jsdom's KeyboardEvent does not
 * populate across shadow roots the way a browser does — so the path is supplied
 * directly. That is honest about what is being proved: the *rule*, not the
 * browser's retargeting.
 */
function keyEvent(key: string, path: EventTarget[]): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key });
  Object.defineProperty(event, 'composedPath', { value: () => path });
  return event;
}

describe('isTypingTarget', () => {
  it('is true for the elements a keystroke can be typed into', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const node = document.createElement(tag);
      expect(isTypingTarget(keyEvent('z', [node])), tag).toBe(true);
    }
  });

  it('is true for a contenteditable', () => {
    const node = document.createElement('div');
    node.contentEditable = 'true';
    Object.defineProperty(node, 'isContentEditable', { value: true });
    expect(isTypingTarget(keyEvent('z', [node]))).toBe(true);
  });

  it('reads the innermost node, not the retargeted host', () => {
    // The whole reason it uses composedPath()[0]: a Shoelace input retargets to
    // <sl-input>, whose tag name is not "input". Checking the host would let a
    // bare-key shortcut eat the character being typed.
    const inner = document.createElement('input');
    const host = document.createElement('sl-input');
    expect(isTypingTarget(keyEvent('z', [inner, host]))).toBe(true);
    expect(isTypingTarget(keyEvent('z', [host]))).toBe(false);
  });

  it('is false over ordinary content, so shortcuts still work', () => {
    expect(isTypingTarget(keyEvent('j', [document.createElement('div')]))).toBe(false);
    expect(isTypingTarget(keyEvent('j', []))).toBe(false);
  });
});

describe('isInsideOpenDialog', () => {
  it('is true inside an open sl-dialog', () => {
    const dialog = document.createElement('sl-dialog');
    dialog.setAttribute('open', '');
    const button = document.createElement('button');
    expect(isInsideOpenDialog(keyEvent('Escape', [button, dialog]))).toBe(true);
  });

  it('is false for a dialog that is closed', () => {
    const dialog = document.createElement('sl-dialog');
    expect(isInsideOpenDialog(keyEvent('Escape', [dialog]))).toBe(false);
  });

  it('is false with no dialog on the path at all', () => {
    expect(isInsideOpenDialog(keyEvent('Escape', [document.createElement('div')]))).toBe(false);
  });
});
