import { css, unsafeCSS } from 'lit';
import type { CSSResult } from 'lit';

/**
 * The transient glow a reveal puts on the object an undo or redo just changed.
 *
 * One module for all three marker types, because it is **one signal**: "this is
 * what moved". Each object has its own ink by design — cyan crosshair, amber
 * diamond, magenta car (`SPEC.md` § Reference points) — so a highlight drawn in
 * any of those colours would read as a fourth kind of object rather than as an
 * annotation on the three. It is white and it is a *glow*, outside the symbol,
 * so nothing about the symbol's own shape or colour changes: a car that is red
 * because its class is unknown stays visibly red while it is lit.
 *
 * **Why highlighting exists at all** (#37, `SPEC.md` § Undo and redo): the
 * history's invariant is that undo must make its own effect visible. Selecting
 * the right image gets the user to the right frame; without this they arrive on
 * a frame of labels and are left to spot which one changed. It matters most
 * where the change is a *deletion* — there is then nothing new to see — and the
 * neighbouring objects are what the glow is measured against.
 *
 * {@link HIGHLIGHT_CLASS} and {@link highlightStyles} **must be used
 * together**, like every other export pair in the marker modules: the class
 * does nothing without the keyframes, and the keyframes reach nothing without
 * the class.
 */
export const HIGHLIGHT_CLASS = 'reveal-highlight';

/**
 * How long the glow lasts, in milliseconds.
 *
 * Shared by the CSS below and by the timer in `rr-editor-view` that takes the
 * class off again — one number, because a fade that outlasts its class ends
 * abruptly and a class that outlasts its fade leaves an element marked as lit
 * with nothing to show for it.
 *
 * Long enough to be seen after the eye has moved to a newly revealed image,
 * short enough that a held-down Cmd+Z does not leave the frame glowing.
 */
export const HIGHLIGHT_DURATION_MS = 1400;

export const highlightStyles: CSSResult = css`
  /* A glow that fades out, not a colour change: the symbol underneath keeps
     saying what it is. drop-shadow rather than a stroke or a filled halo,
     because it follows the rendered shape — a crosshair's arms, a diamond's
     outline, a car's whole rectangle — with nothing per-symbol to author. */
  @keyframes reveal-highlight-fade {
    0% {
      filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.95))
        drop-shadow(0 0 12px rgba(255, 255, 255, 0.7));
    }
    100% {
      filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0))
        drop-shadow(0 0 12px rgba(255, 255, 255, 0));
    }
  }

  .${unsafeCSS(HIGHLIGHT_CLASS)} {
    /* Filled forwards so the last frame holds until the class is removed: the
       animation is the shorter of the two clocks only by rounding, and a
       restarted glow at the end would read as a second edit. */
    animation: reveal-highlight-fade ${HIGHLIGHT_DURATION_MS}ms ease-out forwards;
  }
`;
