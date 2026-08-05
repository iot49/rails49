/**
 * Who owns a keystroke.
 *
 * Two views now bind bare-key shortcuts to `window` — `rr-app`'s Cmd+Z and the
 * diagnostics queue's `j`/`k`/`z`/arrows/Escape — and a `window` listener sees
 * every keystroke on the page, including the ones being typed into a field
 * somewhere else. These predicates are the one place that judgement lives, so
 * the two cannot disagree about it.
 *
 * Pure and DOM-only, so jsdom can prove both.
 */

/**
 * True when a keystroke is being typed into a field, so the browser's own
 * behaviour must win over any shortcut.
 *
 * Reads `composedPath()[0]`, not `event.target`: Shoelace inputs are custom
 * elements, so the event is retargeted to the host and the focused `<input>`
 * sits inside its shadow root. Checking `target` would see `<sl-input>`, decide
 * it is not editable, and hijack Cmd+Z in the middle of typing a layout name —
 * or swallow the `z` of "Zurich" into a diagnostics shortcut.
 */
export function isTypingTarget(event: KeyboardEvent): boolean {
  const node = event.composedPath()[0] as HTMLElement | undefined;
  if (!node || typeof node.tagName !== 'string') return false;
  const tag = node.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable === true;
}

/**
 * True when the keystroke happened inside an open modal dialog.
 *
 * A dialog is a mode: while one is up it owns the keyboard, and Escape belongs
 * to it rather than to whatever is behind it. Without this, Escape typed into
 * the settings dialog would close the diagnostics queue underneath and leave
 * the dialog open — dismissing the thing the user is not looking at.
 *
 * Matched on the composed path rather than by querying the document, because
 * the dialog lives in another component's shadow root and the path is the only
 * thing that crosses those boundaries.
 */
export function isInsideOpenDialog(event: KeyboardEvent): boolean {
  return event.composedPath().some(target => {
    const node = target as HTMLElement;
    if (!node || typeof node.tagName !== 'string') return false;
    const tag = node.tagName.toLowerCase();
    return (tag === 'sl-dialog' || tag === 'dialog' || node.getAttribute?.('role') === 'dialog')
      && node.hasAttribute?.('open');
  });
}
