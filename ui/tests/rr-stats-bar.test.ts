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
});
