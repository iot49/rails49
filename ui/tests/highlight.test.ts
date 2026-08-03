import { describe, it, expect } from 'vitest';
import { HIGHLIGHT_CLASS, HIGHLIGHT_DURATION_MS, highlightStyles } from '../src/highlight.js';

// The two exports must be used together, like every other marker pair: the
// class does nothing without the keyframes, and the keyframes reach nothing
// without the class. jsdom neither lays out nor paints, so nothing here claims
// the glow is visible — only that a host adopting these styles has a rule for
// the class the renderers write.

describe('highlightStyles', () => {
  it('carries a rule for the class the renderers put on their group', () => {
    expect(highlightStyles.cssText).toContain(`.${HIGHLIGHT_CLASS}`);
  });

  it('animates rather than recolouring, so the symbol keeps saying what it is', () => {
    expect(highlightStyles.cssText).toContain('@keyframes');
    expect(highlightStyles.cssText).toContain('drop-shadow');
    // No fill, stroke or colour of its own: an ink change would make the glow
    // read as a fourth kind of object rather than as an annotation on three.
    expect(highlightStyles.cssText).not.toContain('fill:');
    expect(highlightStyles.cssText).not.toContain('stroke:');
  });

  it('fades over the same clock the editor removes the class on', () => {
    // Two clocks that disagree are a fade that ends abruptly, or an element
    // left marked as lit with nothing to show for it.
    expect(highlightStyles.cssText).toContain(`${HIGHLIGHT_DURATION_MS}ms`);
  });
});
