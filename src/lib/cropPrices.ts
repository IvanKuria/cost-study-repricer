import type { ParsedStudy } from '../data/studySchema';
import type { CropPrice, PublishedPrice } from './types';
import { CROP_PRICE_RULES, ORGANIC_DISCLAIMER, STALE_YEARS, STUDY_YEAR_REACH, type CropPriceRule } from '../data/cropPriceMapping';
import pricesJson from '../data/cropPrices.json';

/** USDA NASS California prices received, built by `npm run ingest:prices`. */
export const CROP_PRICES: CropPrice[] = pricesJson as unknown as CropPrice[];

const UNIT_WORDS: [RegExp, string][] = [
  [/^(lb|lbs|pound|pounds)$/, 'lb'], [/^(ton|tons)$/, 'ton'], [/^(box|boxes|bx)$/, 'box'], [/^(carton|cartons|ctn|ctns|crtn|crtns)$/, 'carton'],
  [/^(tray|trays)$/, 'tray'], [/^(cwt|cwts)$/, 'cwt'], [/^(gal|gals|gallon|gallons)$/, 'gal'], [/^(bin|bins)$/, 'bin'], [/^(bale|bales)$/, 'bale'], [/^(bushel|bushels|bu)$/, 'bushel'],
];
export const unitWord = (word: string | null | undefined) => {
  const w = (word ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return UNIT_WORDS.find(([re]) => re.test(w))?.[1] ?? null;
};
/** The unit a NASS price is quoted in: '$ / TON, DRY BASIS' is ton, '$ / BOX, ON TREE EQUIV' is box. */
export const nassUnit = (unit: string) => unitWord(unit.replace(/^\$\s*\/\s*/, '').split(',')[0]);

/** The year the study's prices are from: its stated price year, else the study year. */
export const studyPriceYear = (study: ParsedStudy): number | null => study.source.priceYear?.value ?? study.source.year ?? null;

export interface PriceLine { name: string; unit: string; price: number | null }
/** The USDA price for one line, or why the study price is kept. */
export interface PriceLookup { published: PublishedPrice | null; kept: string | null; series: CropPrice | null }

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const changeText = (change: number) => `${change >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(change * 100))}%`;
const crop = (series: string) => series.split(' - ')[0].toLowerCase();

function ruleFor(study: ParsedStudy, line: PriceLine, isMain: boolean): CropPriceRule | null {
  const text = `${study.source.id} ${study.source.description ?? ''}`;
  return CROP_PRICE_RULES.find(r => r.commodity === study.source.commodity && (!r.study || r.study.test(text)) && (r.line ? r.line.test(line.name) : isMain)) ?? null;
}

/**
 * The study price adjusted by USDA's California price ratio, as of the target month: study price x (USDA price in the
 * newest marketing year before the target's year / USDA price in the study's price year). The ratio has no units, so
 * any line USDA prices can be adjusted, containers included. `isMain` lets a commodity's general rule apply; other
 * lines need a rule naming them.
 */
export function publishedPrice(study: ParsedStudy, line: PriceLine, isMain: boolean, target: string, prices: CropPrice[]): PriceLookup {
  const keep = (kept: string, series: CropPrice | null = null): PriceLookup => ({ published: null, kept, series });
  const rule = ruleFor(study, line, isMain);
  if (!rule) return keep(isMain ? `USDA publishes no California price for ${study.source.commodity.replace(/[–-]/g, ' ')}.` : 'No USDA price matches this line.');
  if (!rule.series) return keep(rule.reason ?? 'USDA publishes no comparable price.');
  const series = prices.find(p => p.id === rule.series);
  if (!series || !Object.keys(series.values).length) return keep(`USDA has published no California figure for ${crop(rule.series)} (withheld or not collected).`);
  if (line.price == null || !(line.price > 0)) return keep('The study prints no price for this line, so there is nothing to adjust.', series);
  const per = nassUnit(series.unit) ?? series.unit;
  const targetYear = Number(target.slice(0, 4));
  const year = Object.keys(series.values).filter(y => Number(y) < targetYear).sort().at(-1);
  if (!year) return keep(`USDA has no California price for ${crop(series.id)} before ${targetYear}.`, series);
  const sy = studyPriceYear(study);
  if (sy == null) return keep('The study states no price year, so the USDA price change cannot be measured.', series);
  if (Number(year) <= sy) return keep(`USDA's latest California price for ${crop(series.id)} is for ${year}, not newer than the study's ${sy} price.`, series);
  // USDA's price in the study's year, or the nearest earlier year USDA published within reach.
  const studyYear = Object.keys(series.values).filter(y => Number(y) <= sy && Number(y) >= sy - STUDY_YEAR_REACH).sort().at(-1);
  if (!studyYear) return keep(`USDA published no California price for ${crop(series.id)} in or near the study's ${sy} price year, so the change cannot be measured.`, series);
  const value = series.values[year], studyYearPrice = series.values[studyYear];
  const ratio = value / studyYearPrice;
  const disclaimers: string[] = [];
  if (rule.disclaimer) disclaimers.push(rule.disclaimer);
  if (/organic/i.test(`${study.source.id} ${study.source.description ?? ''} ${line.name}`) && !/conventional/i.test(line.name)) disclaimers.push(ORGANIC_DISCLAIMER);
  if (targetYear - 1 - Number(year) >= STALE_YEARS) disclaimers.push(`USDA has published no California price for ${crop(series.id)} newer than ${year}.`);
  if (studyYear !== String(sy)) disclaimers.push(`USDA published no ${sy} price, so the change is measured from ${studyYear}.`);
  return {
    series, kept: null,
    published: { seriesId: series.id, year, value, per, price: line.price * ratio, studyPrice: line.price, studyYear, studyYearPrice, change: ratio - 1, disclaimers },
  };
}

/** How USDA's price moved since the study: "USDA's California price went from $2.34 per lb in 2024 to $2.60 in 2025, up 11%." */
export function movedText(p: PublishedPrice): string {
  return `USDA's California price went from ${money(p.studyYearPrice)} per ${p.per} in ${p.studyYear} to ${money(p.value)} in ${p.year}, ${changeText(p.change)}.`;
}

/** One plain sentence on an adjusted price: the study price, the USDA ratio, and the result. */
export function publishedNote(p: PublishedPrice, unit: string): string {
  return `Study price ${money(p.studyPrice)} per ${unit} x USDA California ratio (${money(p.value)} in ${p.year} / ${money(p.studyYearPrice)} in ${p.studyYear}) = ${money(p.price)} per ${unit}. ${movedText(p)}`;
}
