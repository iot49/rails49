import { describe, it, expect } from 'vitest';
import type { CSSResult, CSSResultGroup } from 'lit';
import { COMPACT_MAX_HEIGHT_PX, compactStripStyles } from '../src/layout.js';
import { RREditorView } from '../src/rr-editor-view.js';
import { RRToolbar } from '../src/rr-toolbar.js';
import { RRToolPalette } from '../src/rr-tool-palette.js';

/**
 * Flattens a component's `static styles` — one `css` literal or an array of
 * them — into the text a browser would parse.
 */
function cssTextOf(styles: CSSResultGroup | undefined): string {
  if (!styles) return '';
  if (Array.isArray(styles)) return styles.map(cssTextOf).join('\n');
  const text = (styles as CSSResult).cssText;
  // A `CSSStyleSheet` reaching here has no `cssText`, and an empty string would
  // let every assertion below pass by finding nothing to check.
  if (typeof text !== 'string' || text === '') {
    throw new Error('styles entry carries no cssText to inspect');
  }
  return text;
}

/**
 * jsdom does not lay out, so none of this proves the reflow *fits*. That was
 * measured in a browser (#42) and cannot be re-measured here.
 *
 * What it does guard is the one hazard the reflow introduces: three components
 * switch at the same height, and a stylesheet that misses the breakpoint leaves
 * a vertical stack inside a horizontal strip — taller than the column it
 * replaced, which is the bug the reflow exists to fix.
 */
describe('the compact-height reflow', () => {
  const QUERY = `@media (max-height: ${COMPACT_MAX_HEIGHT_PX}px)`;

  it.each([
    ['rr-editor-view', RREditorView],
    ['rr-toolbar', RRToolbar],
    ['rr-tool-palette', RRToolPalette],
  ])('%s reflows at the shared breakpoint', (_name, ctor) => {
    expect(cssTextOf(ctor.styles)).toContain(QUERY);
  });

  it('states the turn once, in the shared rules both elements use', () => {
    // The breakpoint agreeing is not the whole hazard: two copies of the rules
    // *inside* the query could still drift while every component still
    // switches at the same height.
    expect(cssTextOf(compactStripStyles)).toContain(QUERY);
    for (const ctor of [RRToolbar, RRToolPalette]) {
      const styles = ctor.styles;
      expect(Array.isArray(styles) && styles.includes(compactStripStyles)).toBe(true);
    }
  });

  it('carries no second, hardcoded breakpoint that could drift from it', () => {
    for (const ctor of [RREditorView, RRToolbar, RRToolPalette]) {
      const heightQueries = cssTextOf(ctor.styles).match(/max-height:\s*\d+px/g) ?? [];
      for (const q of heightQueries) {
        expect(q).toBe(`max-height: ${COMPACT_MAX_HEIGHT_PX}px`);
      }
    }
  });
});
