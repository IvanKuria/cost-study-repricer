import { describe, expect, it } from 'vitest';
import { studyPicks } from './studies';
import { hasLayout, switchLayout, type ControlsValue } from '@/screens/Controls';

const picks = studyPicks();
const base: ControlsValue = { layout: 'production', crop: null, study: null, target: null, rate: null, crRate: null, acres: 1 };

describe('table toggle', () => {
  it('keeps the study when it has the other table', () => {
    const both = picks.find(p => p.hasEstablishment && p.hasProduction)!;
    expect(switchLayout({ ...base, crop: both.commodity, study: both.id }, 'establishment', picks)).toMatchObject({ layout: 'establishment', crop: both.commodity, study: both.id });
  });
  it('clears the study when it lacks the other table, and the crop when no study of the crop has it', () => {
    const prodOnly = picks.find(p => p.id === 'almonds-almondorganicnsjv-final-publish-update')!;
    expect(switchLayout({ ...base, crop: 'almonds', study: prodOnly.id, crRate: 0.05 }, 'establishment', picks)).toMatchObject({ layout: 'establishment', crop: 'almonds', study: null, crRate: null });
    const hedgerow = 'blue-elderberry-20blueelderberryhedgerowwithouttillage';
    const crop = picks.find(p => p.id === hedgerow)!.commodity;
    const cropHasProduction = picks.some(p => p.commodity === crop && p.hasProduction);
    expect(switchLayout({ ...base, layout: 'establishment', crop, study: hedgerow }, 'production', picks)).toMatchObject({ layout: 'production', study: null, crop: cropHasProduction ? crop : null });
  });
  it('reads each layout from the manifest', () => {
    const hedgerow = picks.find(p => p.id === 'blue-elderberry-20blueelderberryhedgerowwithouttillage')!;
    expect(hasLayout(hedgerow, 'establishment')).toBe(true);
    expect(hasLayout(hedgerow, 'production')).toBe(false);
  });
});
