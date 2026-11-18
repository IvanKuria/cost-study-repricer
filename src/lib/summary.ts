import type { RepricedCell, RepricedRow, RepricedTable } from './types';

export interface Pair { original: number | null; repriced: number | null }
const pair = (c: RepricedCell | undefined): Pair => ({ original: c?.original ?? null, repriced: c?.repriced ?? null });
type F = keyof Pair;

/** Total cost, gross returns and net returns above total cost per acre, read from the repriced rows: the production table's
 *  totals, or the establishment table's rows in the summary year, by the totals and net rows reprice.ts marks. */
export function summaryFigures(table: RepricedTable): { column: string | null; cost: Pair; gross: Pair; net: Pair } {
  if (table.layout === 'production') {
    const at = (id: string) => pair(table.rows.find(r => r.id === id)?.cells.total);
    return { column: null, cost: at('total'), gross: at('gross'), net: at('net-total') };
  }
  const col = table.columns.find(c => c.label === table.summaryColumn) ?? table.columns.at(-1);
  const key = col?.key ?? '';
  const v = (r: RepricedRow | undefined, f: F) => r?.cells[key]?.[f] ?? null;
  // The last of each, as reprice.ts keeps the last row of each total (the 2015 wine grape study prints TOTAL COSTS/ACRE twice).
  const total = (k: RepricedRow['totalKey']) => table.rows.findLast(r => r.totalKey === k);
  const totalRow = total('total'), cash = total('cash'), noncash = total('noncash');
  // A table without a TOTAL COST row (the 2011 avocado studies) still has one: cash plus non-cash, as reprice.ts adds them.
  const costOf = (f: F) => totalRow ? v(totalRow, f) : v(cash, f) == null && v(noncash, f) == null ? null : (v(cash, f) ?? 0) + (v(noncash, f) ?? 0);
  const cost: Pair = totalRow || cash || noncash ? { original: costOf('original'), repriced: costOf('repriced') } : { original: table.summary.totalPerAcreOriginal, repriced: table.summary.totalPerAcreRepriced };
  // Gross returns: the income row printed with the net rows against total cost, else any income row with a figure this year.
  const nets = table.rows.filter(r => r.net?.basis === 'total');
  const incomes = table.rows.filter(r => r.kind === 'returns');
  const has = (r: RepricedRow) => v(r, 'original') != null || v(r, 'repriced') != null;
  const gross = pair((incomes.find(r => has(r) && r.section === nets[0]?.section) ?? incomes.find(has))?.cells[key]);
  // That row left blank in the study (2005 pecans' total section): the year's income as printed above.
  gross.original ??= v(incomes.find(r => v(r, 'original') != null), 'original');
  // Net returns: the net row showing this year (a net cost counts negative); a clamped row's 0 is the other side of the year.
  // With none, income less total cost, as the net rows are computed.
  const netOf = (f: F): number | null => {
    for (const r of nets) {
      const x = v(r, f);
      if (x == null || (r.net!.clamped && x === 0)) continue;
      return r.net!.profit ? x : -x;
    }
    const c = cost[f], g = gross[f];
    return c == null || (g == null && !nets.length) ? null : (g ?? 0) - c;
  };
  return { column: table.summaryColumn ?? col?.label ?? null, cost, gross, net: { original: netOf('original'), repriced: netOf('repriced') } };
}
