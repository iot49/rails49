import { describe, it, expect } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import '../src/rr-stats-bar.js';
import { RRStatsBar } from '../src/rr-stats-bar.js';

describe('rr-stats-bar', () => {
  it('is defined', () => {
    const el = document.createElement('rr-stats-bar');
    expect(el).to.be.instanceOf(RRStatsBar);
  });

  it('renders all stats', async () => {
    const el = await fixture<RRStatsBar>(html`
      <rr-stats-bar
        .fps=${60}
        .cars=${10}
        .occupied=${3}
        .inference=${1.2}
      ></rr-stats-bar>
    `);

    const text = el.shadowRoot!.textContent || '';
    expect(text).to.contain('60.0');
    expect(text).to.contain('10');
    expect(text).to.contain('Inference');
    expect(text).to.contain('1.2ms');
  });

  it('shows L0 and L1 as separate numbers', async () => {
    // Cars found and sensors occupied are different counts and the pair is the
    // readout: cars with no occupied sensor is either an empty siding or a
    // sensor in the wrong place, and one number cannot say which.
    const el = await fixture<RRStatsBar>(html`
      <rr-stats-bar .cars=${4} .occupied=${0}></rr-stats-bar>
    `);

    const rows = [...el.shadowRoot!.querySelectorAll('.stat')].map(r => r.textContent ?? '');
    expect(rows.find(r => r.includes('Cars'))).to.contain('4');
    expect(rows.find(r => r.includes('Occupied'))).to.contain('0');
  });

  describe('the alignment readout', () => {
    const driftRow = (el: RRStatsBar) =>
      [...el.shadowRoot!.querySelectorAll('.stat')].find(r => r.textContent?.includes('Drift:'));

    it('shows the measurement against the tolerance', async () => {
      // Both numbers, because the ratio is what a user aiming a camera judges.
      // A red/green dot would discard exactly that.
      const el = await fixture<RRStatsBar>(html`
        <rr-stats-bar .alignment=${3.4} .alignmentTolerance=${22.4}></rr-stats-bar>
      `);

      const row = driftRow(el)!;
      expect(row).to.exist;
      expect(row.textContent).to.contain('3.4px');
      expect(row.textContent).to.contain('22.4px');
      expect(row.classList.contains('over')).to.be.false;
    });

    it('marks a measurement past the tolerance', async () => {
      const el = await fixture<RRStatsBar>(html`
        <rr-stats-bar .alignment=${40} .alignmentTolerance=${22.4}></rr-stats-bar>
      `);
      expect(driftRow(el)!.classList.contains('over')).to.be.true;
    });

    it('shows an em dash before anything has been measured, never 0.0', async () => {
      // "not measured yet" and "measured, and the camera has not moved" are
      // different facts. This is the one readout where a zero is a claim.
      const el = await fixture<RRStatsBar>(html`
        <rr-stats-bar .alignment=${null} .alignmentTolerance=${22.4}></rr-stats-bar>
      `);

      const row = driftRow(el)!;
      expect(row.textContent).to.contain('—');
      expect(row.textContent).to.not.contain('0.0px');
    });

    it('renders no row at all when no tolerance resolves', async () => {
      // An uncalibrated layout has no track width to take a fraction of, and a
      // bare pixel count invites the reader to supply their own threshold.
      const el = await fixture<RRStatsBar>(html`
        <rr-stats-bar .alignment=${9} .alignmentTolerance=${null}></rr-stats-bar>
      `);
      expect(driftRow(el)).to.be.undefined;
    });
  });
});
