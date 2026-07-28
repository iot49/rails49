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
        .count=${10}
        .sampleTime=${1.2}
      ></rr-stats-bar>
    `);
    
    const text = el.shadowRoot!.textContent || '';
    expect(text).to.contain('60.0');
    expect(text).to.contain('10');
    expect(text).to.contain('Time per Marker');
    expect(text).to.contain('1.2ms');
  });
});
