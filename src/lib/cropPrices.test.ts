import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { CROP_PRICE_SERIES } from '../data/cropPriceMapping';
import { CROP_PRICES } from './cropPrices';
import { defaultSalePrice, repriceStudy } from './reprice';
import { returnLines } from './exportShared';

const load = (id: string) => JSON.parse(readFileSync(`data/studies/parsed/${id}.json`, 'utf8')) as ParsedStudy;
const series = (id: string) => CROP_PRICES.find(s => s.id === id)!;
const ALMOND = 'almonds-2024sacvalleyalmonds7-5-24-final-draft';
const ALMOND_SERIES = 'ALMONDS - PRICE RECEIVED, MEASURED IN $ / LB';
const prod = { layout: 'production' as const, targetPeriod: '2026-07', cropPrices: CROP_PRICES };
const cell = (t: ReturnType<typeof repriceStudy>, id: string) => t.rows.find(r => r.id === id)!.cells.total;
const line = (t: ReturnType<typeof repriceStudy>, i = 0) => t.rows.find(r => r.id === `ret-${i}`)!;

describe('USDA crop prices', () => {
  it('loads every series the mapping names, with published marketing years only', () => {
    for (const id of CROP_PRICE_SERIES) {
      const s = series(id);
      expect(s, id).toBeTruthy();
      expect(Object.keys(s.values).length, id).toBeGreaterThan(0);
      for (const [y, v] of Object.entries(s.values)) { expect(y).toMatch(/^\d{4}$/); expect(v, `${id} ${y}`).toBeGreaterThan(0); }
    }
  });

  it('adjust the main line price by USDA\'s ratio, latest year before the target over the study year', () => {
    const s = load(ALMOND);
    s.establishment = null; s.establishmentSummary = undefined; // isolate the production line
    const usda = series(ALMOND_SERIES).values;
    const ratio = usda['2025'] / usda['2024'];
    const base = repriceStudy(s, { layout: 'production', targetPeriod: '2026-07' });
    const t = repriceStudy(s, prod);
    const l = s.assumptions.returns[0];
    const r = line(t);
    expect(r.returnLine!.published).toMatchObject({ year: '2025', value: usda['2025'], studyYear: '2024', studyYearPrice: usda['2024'], studyPrice: l.price });
    expect(r.returnLine!.published!.price).toBeCloseTo(l.price * ratio, 10);
    expect(r.returnLine!.published!.change).toBeCloseTo(ratio - 1, 10);
    expect(r.returnLine!.price.current).toBeCloseTo(l.price * ratio, 10);
    expect(r.cells.total.repriced).toBeCloseTo(l.value * ratio, 8);
    expect(r.cells.total.overridden).toBe(false);
    expect(r.cells.total.note).toMatch(/Study price \$1\.60 per Lb x USDA California ratio \(\$2\.60 in 2025 \/ \$2\.34 in 2024\)/);
    expect(cell(t, 'gross').repriced! - cell(base, 'gross').repriced!).toBeCloseTo(l.value * (ratio - 1), 6);
    expect(t.priceSources).toEqual([{ series: series(ALMOND_SERIES), year: '2025', value: usda['2025'] }]);
    // A lender's price still wins.
    const edited = repriceStudy(s, { ...prod, overrides: { 'ret-0:price': 3 } });
    expect(cell(edited, 'ret-0').repriced).toBeCloseTo(l.quantity * 3, 8);
    expect(line(edited).returnLine!.price.edited).toBe(true);
    // Repriced to mid-2025, the newest USDA price is 2024: not newer than the study's 2024 price, so the study price stays.
    const earlier = repriceStudy(s, { ...prod, targetPeriod: '2025-06' });
    expect(line(earlier).returnLine!.published).toBeNull();
    expect(line(earlier).returnLine!.kept).toMatch(/2024, not newer than the study's 2024 price/);
    expect(cell(earlier, 'ret-0').repriced).toBe(l.value);
  });

  it('adjust any unit by the ratio, cartons included', () => {
    const w = series('WALNUTS, ENGLISH - PRICE RECEIVED, MEASURED IN $ / TON').values;
    const walnuts = line(repriceStudy(load('walnuts-23walnutssacval-final-3-26-24'), prod)).returnLine!.published!;
    expect(walnuts).toMatchObject({ per: 'ton', studyYear: '2023' });
    expect(walnuts.price).toBeCloseTo(0.5 * w['2025'] / w['2023'], 10);
    const h = series('LETTUCE, HEAD - PRICE RECEIVED, MEASURED IN $ / CWT').values;
    const lettuce = load('lettuce-2023-iceberglettuce-full-final');
    const t = repriceStudy(lettuce, prod);
    expect(line(t).returnLine!.published!.price).toBeCloseTo(21 * h['2025'] / h['2023'], 10);
    expect(cell(t, 'ret-0').repriced).toBeCloseTo(lettuce.assumptions.returns[0].value * h['2025'] / h['2023'], 6);
  });

  it('price wine grapes and organic studies with USDA, with disclaimers', () => {
    const napa = line(repriceStudy(load('grapes-wine-2020napawinegrape'), prod)).returnLine!.published!;
    const wine = series('GRAPES, WINE TYPE - PRICE RECEIVED, MEASURED IN $ / TON').values;
    expect(napa.price).toBeCloseTo(8200 * wine['2025'] / wine['2020'], 8);
    expect(napa.disclaimers.join(' ')).toMatch(/statewide average; prices in a district or for a variety can move differently/);
    const organic = line(repriceStudy(load('almonds-almondorganicnsjv-final-publish-update'), prod)).returnLine!.published!;
    expect(organic.disclaimers.join(' ')).toMatch(/does not separate organic from conventional/);
    const pears = repriceStudy(load('pears-pearsorg-sv2012'), prod);
    const conventional = pears.rows.find(r => r.label === 'Conventional')!.returnLine!.published!;
    expect(conventional.disclaimers.join(' ')).not.toMatch(/organic/);
  });

  it('keep the study price for lines USDA does not price, with the reason', () => {
    const rice = repriceStudy(load('rice-ricesv2012'), prod);
    expect(line(rice, 1).returnLine!.kept).toMatch(/government direct payment/);
    expect(line(rice, 0).returnLine!.published).not.toBeNull();
    const beans = line(repriceStudy(load('beans-2023-baby-lima-final'), prod)).returnLine!;
    expect(beans.published).toBeNull();
    expect(beans.kept).toMatch(/not newer than the study's 2023 price/);
  });

  it('set the establishment sale price, which moves the accumulated cost and the recalculated yearly charge', () => {
    const s = load(ALMOND);
    const usda = series(ALMOND_SERIES).values;
    const p = s.assumptions.returns[0].price * usda['2025'] / usda['2024'];
    expect(defaultSalePrice(s, { cropPrices: CROP_PRICES }, '2026-07')!.price).toBeCloseTo(p, 10);
    const est = repriceStudy(s, { targetPeriod: '2026-07', cropPrices: CROP_PRICES });
    const yields = s.establishment!.table!.yieldRow!.values;
    const k = yields.findIndex(v => v != null && v > 0);
    expect(est.rows.find(r => r.kind === 'returns')!.cells[`y${k + 1}`].repriced).toBeCloseTo(yields[k]! * p, 6);
    expect(est.notes!.some(n => /Sale price for the establishment years and the main return line: Study price/.test(n))).toBe(true);
    const charge = (t: ReturnType<typeof repriceStudy>) => cell(t, 'nc-establishment').repriced!;
    const withUsda = repriceStudy(s, prod), without = repriceStudy(s, { layout: 'production', targetPeriod: '2026-07' });
    expect(p).toBeGreaterThan(s.assumptions.returns[0].price);
    expect(charge(withUsda)).toBeLessThan(charge(without)); // more income in the early years, a smaller investment to recover
    // A lender's establishment sale price beats the USDA price.
    const lender = repriceStudy(s, { targetPeriod: '2026-07', cropPrices: CROP_PRICES, pricePerUnit: 1 });
    expect(lender.rows.find(r => r.kind === 'returns')!.cells[`y${k + 1}`].repriced).toBeCloseTo(yields[k]!, 6);
  });

  it('exports name USDA as the price source with the change since the study', () => {
    const lines = returnLines(repriceStudy(load(ALMOND), prod));
    expect(lines[0].what).toBe('USDA California, 2025');
    expect(lines[0].note).toMatch(/USDA's California price went from \$2\.34 per lb in 2024 to \$2\.60 in 2025, up 11%/);
  });
});
