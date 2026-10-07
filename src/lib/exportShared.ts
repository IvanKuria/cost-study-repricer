import type { RepricedRow, RepricedTable, Series, StudyPick } from './types';
import { MONTHS } from '@/ui';

export interface ExportMeta {
  sourcesUrl?: string;
  study: StudyPick | null;
  series: Series[];
  interestRate: number | null;
  interestSource: string;
  acres: number;
  mappingNotes: { label: string; series: string; note: string }[];
}

export const periodText = (p: string) => { const [y, m] = p.split('-'); return `${MONTHS[Number(m) - 1] ?? m} ${y}`; };

/** Numbers the way the study prints them: whole dollars, commas, minus sign, blank for null. */
export const fmt = (n: number | null | undefined) => n === null || n === undefined || !Number.isFinite(n) ? '' : `${n < 0 ? '-' : ''}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const fmtHrs = (n: number | null) => n === null || !Number.isFinite(n) || n === 0 ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** The value the lender sees for a row's cell: the override when present, else the repriced figure. */
export function shown(row: RepricedRow, col: string): number | null {
  const c = row.cells[col];
  return c ? c.repriced : null;
}

/** Plain-words sentence under the table and in the export footer. */
export function repricingSentence(table: RepricedTable, meta: ExportMeta): string {
  const yr = meta.study?.year ?? table.referencePeriod.slice(0, 4);
  const withIndex = [...new Set(table.summary.coverage.filter(c => c.seriesId.startsWith('nass.') && c.share > 0).map(c => c.category))];
  const names: Record<string, string> = { labor: 'labor', fuelLubeRepairs: 'fuel, lube and repairs', fertilizer: 'fertilizer', pesticides: 'pesticides', nonCashOverhead: 'machinery', custom: 'custom work', water: 'water', pollination: 'pollination', otherMaterials: 'other materials', cashOverhead: 'cash overhead', operatingInterest: 'operating interest' };
  const list = withIndex.map(c => names[c] ?? c);
  const indexed = list.length ? `${list.join(', ')} use USDA prices-paid indexes` : 'no line matched a USDA prices-paid index';
  const cpi = `${Math.round(table.summary.cpiShare * 100)} percent of cost used the consumer price index because no producer index applies`;
  const rate = meta.interestRate !== null ? `operating interest at ${(meta.interestRate * 100).toFixed(2)} percent (${meta.interestSource})` : "operating interest at the study's own rate";
  const edits = table.rows.some(r => Object.values(r.cells).some(c => c.overridden)) ? ' Edited values are marked.' : '';
  return `Repriced from the ${yr} study (prices as of ${periodText(table.referencePeriod)}) to ${periodText(table.targetPeriod)}. ${indexed[0].toUpperCase()}${indexed.slice(1)}; ${cpi}; ${rate}.${edits}`;
}

/** How many priced rows fell to the CPI because no specific index matched their label. */
export function fallbackSentence(table: RepricedTable): string {
  const { fallbackRows: n, pricedRows: m } = table.summary;
  if (!m) return 'No row was priced by an index.';
  if (!n) return `None of the ${m} priced rows use the CPI fallback; each matched a specific index.`;
  return `${n} of ${m} priced rows use the CPI fallback because no specific index matched${n === 1 ? ' its label' : ' their labels'}.`;
}

export function hasOverrides(table: RepricedTable): boolean {
  return table.rows.some(r => Object.values(r.cells).some(c => c.overridden));
}

/** Peak cash need per acre for an establishment table: the largest value on the accumulated net cash cost row. */
export function peakCash(table: RepricedTable): { value: number; column: string } | null {
  if (table.layout !== 'establishment') return null;
  const row = table.rows.find(r => /accumulated.*cash/i.test(r.label));
  if (!row) return null;
  let best: { value: number; column: string } | null = null;
  for (const col of table.columns) {
    const v = row.cells[col.key]?.repriced;
    if (v !== null && v !== undefined && (best === null || v > best.value)) best = { value: v, column: col.label };
  }
  return best;
}
