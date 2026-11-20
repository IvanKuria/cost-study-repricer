import { describe, expect, it } from 'vitest';
import { parseHash, serializeHash } from './hashState';

describe('hash state', () => {
  it('round-trips the five controls', () => {
    const s = { crop: 'almonds', study: 'almonds-2024-almondssjvsouth-final-draft-8-3-25', target: '2026-07', rate: 0.0751, crRate: 0.065, acres: 40, returns: {} };
    const h = serializeHash(s);
    expect(h).toContain('crop=almonds');
    expect(h).toContain('rate=7.51');
    expect(h).toContain('crrate=6.5');
    expect(parseHash(h)).toEqual(s);
  });
  it('defaults acres to 1, rate to the study rate, and ignores bad targets', () => {
    expect(parseHash('#crop=lettuce&target=july&acres=-3')).toEqual({ crop: 'lettuce', study: null, target: null, rate: null, crRate: null, acres: 1, returns: {} });
    expect(serializeHash({ crop: null, study: null, target: null, rate: null, crRate: null, acres: 1, returns: {} })).toBe('');
  });
  it('round-trips return line edits and a gross returns override, and drops unknown or bad ones', () => {
    const s = { crop: 'cotton', study: 'cotton-cotton2012pima', target: null, rate: null, crRate: null, acres: 1, returns: { 'ret-0:price': 1.42, 'ret-1:quantity': 3.5, 'ret-10:total': 220, 'gross:total': 2100 } };
    const h = serializeHash(s);
    expect(h).toContain('ret-0.price=1.42');
    expect(h).toContain('ret-1.quantity=3.5');
    expect(h).toContain('gross.total=2100');
    expect(parseHash(h)).toEqual(s);
    expect(parseHash('#study=x&ret-0.price=abc&ret-x.price=2&op-1.total=5&ret-2.value=3').returns).toEqual({});
  });

  it('round-trips labor hours and wage edits, and drops mixed or bad keys', () => {
    const s = { crop: 'almonds', study: 'a', target: null, rate: null, crRate: null, acres: 1, returns: { 'op-3:laborHours': 1.5, 'wage:machine': 31.25, 'wage:general': 24 } };
    const h = serializeHash(s);
    expect(h).toContain('op-3.laborHours=1.5');
    expect(h).toContain('wage.machine=31.25');
    expect(parseHash(h)).toEqual(s);
    expect(parseHash('#op-1.price=2&ret-0.laborHours=1&wage.total=3&wage.machine=x&op-x.laborHours=1').returns).toEqual({});
  });

  it('round-trips machine hours edits so a shared link carries them', () => {
    const s = { crop: 'almonds', study: 'a', target: null, rate: null, crRate: null, acres: 1, returns: { 'op-2:machineHours': 0.8, 'op-2:laborHours': 1.1 } };
    const h = serializeHash(s);
    expect(h).toContain('op-2.machineHours=0.8');
    expect(parseHash(h)).toEqual(s);
    expect(parseHash('#ret-0.machineHours=1&op-1.machineHrs=1').returns).toEqual({});
  });
});
