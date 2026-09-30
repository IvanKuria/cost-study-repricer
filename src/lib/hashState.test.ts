import { describe, expect, it } from 'vitest';
import { parseHash, serializeHash } from './hashState';

describe('hash state', () => {
  it('round-trips the five controls', () => {
    const s = { crop: 'almonds', study: 'almonds-2024-almondssjvsouth-final-draft-8-3-25', target: '2026-07', rate: 0.0751, acres: 40 };
    const h = serializeHash(s);
    expect(h).toContain('crop=almonds');
    expect(h).toContain('rate=7.51');
    expect(parseHash(h)).toEqual(s);
  });
  it('defaults acres to 1, rate to the study rate, and ignores bad targets', () => {
    expect(parseHash('#crop=lettuce&target=july&acres=-3')).toEqual({ crop: 'lettuce', study: null, target: null, rate: null, acres: 1 });
    expect(serializeHash({ crop: null, study: null, target: null, rate: null, acres: 1 })).toBe('');
  });
});
