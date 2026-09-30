import type { Series } from './types';
import seriesJson from '../data/series.json';

export const SERIES: Series[] = seriesJson as Series[];
export const seriesById = (id: string, list: Series[] = SERIES): Series | undefined => list.find(s => s.id === id);

export const periodKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
export function parsePeriod(p: string): { year: number; month: number } { const [y, m] = p.split('-').map(Number); return { year: y, month: m }; }
export function comparePeriods(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export interface Lookup { period: string; value: number; exact: boolean }

/**
 * Value at a period, or the nearest earlier period the series has (quarterly series and late months).
 * Returns null when the series has nothing at or before the period.
 */
export function lookup(series: Series, period: string): Lookup | null {
  const direct = series.values[period];
  if (direct !== undefined) return { period, value: direct, exact: true };
  const earlier = Object.keys(series.values).filter(k => k < period).sort();
  const p = earlier.at(-1);
  if (!p) return null;
  return { period: p, value: series.values[p], exact: false };
}

/** Latest period present in every listed series; quarterly series count at their last published period. */
export function latestCommonPeriod(ids: string[], list: Series[] = SERIES): string {
  const lasts = ids.map(id => seriesById(id, list)?.lastPeriod).filter((x): x is string => !!x);
  return lasts.sort()[0] ?? '';
}

/** The latest period of any series in the set: the default target for repricing. */
export function latestPeriod(list: Series[] = SERIES): string {
  return list.map(s => s.lastPeriod).filter(Boolean).sort().at(-1) ?? '';
}

export function ratio(series: Series, from: string, to: string): { factor: number; from: Lookup; to: Lookup } | null {
  const a = lookup(series, from); const b = lookup(series, to);
  if (!a || !b || a.value === 0) return null;
  return { factor: b.value / a.value, from: a, to: b };
}
