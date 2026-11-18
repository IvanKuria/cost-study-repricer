import type { PublishedPrice, RepricedCell, RepricedRow, RepricedTable } from '@/lib/types';
import { movedText } from '@/lib/cropPrices';
import { money } from '@/ui';
import { cn } from '@/lib/utils';
import { LineInput } from './StudyTable';

interface Pair { original: number | null; repriced: number | null }
const pair = (c: RepricedCell | undefined): Pair => ({ original: c?.original ?? null, repriced: c?.repriced ?? null });

/** Total cost, gross returns and net returns above total cost per acre, read from the repriced rows: the production table's
 *  totals, or the establishment table's rows in the summary year (the labels reprice.ts keys its totals by). */
export function summaryFigures(table: RepricedTable): { column: string | null; cost: Pair; gross: Pair; net: Pair } {
  const s = table.summary;
  if (table.layout === 'production') {
    const at = (id: string) => pair(table.rows.find(r => r.id === id)?.cells.total);
    return { column: null, cost: at('total'), gross: at('gross'), net: at('net-total') };
  }
  const col = table.columns.find(c => c.label === table.summaryColumn) ?? table.columns.at(-1);
  const key = col?.key ?? '';
  const L = (r: RepricedRow) => r.label.toUpperCase();
  // The last match, as reprice.ts keeps the last row of each total (the 2015 wine grape study prints TOTAL COSTS/ACRE twice).
  const find = (re: RegExp) => table.rows.findLast(r => r.kind !== 'heading' && re.test(L(r)));
  // A table without a TOTAL COST row (the 2011 avocado studies) still has one: cash plus non-cash, as reprice.ts adds them.
  const totalRow = find(/^TOTAL COST(?:S)?(?:\/ACRE| PER ACRE| FOR THE YEAR)/), cash = find(/^TOTAL CASH COST/), noncash = find(/^TOTAL (NON[- ]?CASH|CAPITAL RECOVERY|INTEREST ON INVESTMENT)/);
  const add = (f: keyof Pair) => cash!.cells[key]?.[f] == null && noncash!.cells[key]?.[f] == null ? null : (cash!.cells[key]?.[f] ?? 0) + (noncash!.cells[key]?.[f] ?? 0);
  const cost = totalRow ? pair(totalRow.cells[key]) : cash && noncash ? { original: add('original'), repriced: add('repriced') } : { original: s.totalPerAcreOriginal, repriced: s.totalPerAcreRepriced };
  // Net rows against total cost, as reprice.ts tells them from the cash ones. A study printing both a net cost and a net
  // profit row clamps each at zero, so the net return is minus the net cost when there is one, else the profit (a printed
  // profit kept against repriced costs can leave both above zero; the net cost row is then the one repriced).
  const nets = table.rows.filter(r => r.kind === 'net' && (/TOTAL/.test(L(r)) || (!/CASH/.test(L(r)) && /non[- ]?cash|capital recovery|interest on investment/i.test(r.section))));
  // Gross returns: the income row printed with those net rows, else any income row with a figure this year.
  const incomes = table.rows.filter(r => r.kind === 'returns');
  const has = (r: RepricedRow) => r.cells[key]?.original != null || r.cells[key]?.repriced != null;
  const gross = pair((incomes.find(r => has(r) && r.section === nets[0]?.section) ?? incomes.find(has))?.cells[key]);
  const profit = nets.find(r => /PROFIT|RETURNS|INCOME/.test(L(r))), loss = nets.find(r => !/PROFIT|RETURNS|INCOME/.test(L(r)));
  const netOf = (f: keyof Pair): number | null => {
    const p = profit?.cells[key]?.[f] ?? null, c = loss?.cells[key]?.[f] ?? null;
    if (profit && loss) return p == null && c == null ? null : (c ?? 0) > 0 ? -c! : p ?? 0;
    return profit ? p : c == null ? null : -c;
  };
  return { column: table.summaryColumn ?? col?.label ?? null, cost, gross, net: nets.length ? { original: netOf('original'), repriced: netOf('repriced') } : { original: null, repriced: null } };
}

/** The main crop's sale price, the same stored edit as the price in the table below. `usda` is the USDA price the default uses, if any. */
export interface YourPriceProps { value: number | null; original: number | null; base: number | null; edited: boolean; unit: string; usda: PublishedPrice | null; where: string; onChange: (value: number | null) => void }

function Figure({ label, p, acres }: { label: string; p: Pair; acres: number }) {
  const m = (n: number | null) => n == null ? '—' : money(n);
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="tnum leading-tight"><span className="text-[14px] text-ink-3">{m(p.original)} →</span> <span className={cn('text-[22px] font-semibold', (p.repriced ?? 0) < 0 && 'text-loss')}>{m(p.repriced)}</span></div>
      {acres !== 1 && <div className="text-[12px] text-ink-3 tnum">{acres.toLocaleString('en-US')} acres: {p.original == null ? '—' : money(p.original * acres)} → {p.repriced == null ? '—' : money(p.repriced * acres)}</div>}
    </div>
  );
}

export function Summary({ table, acres, price }: { table: RepricedTable; acres: number; price: YourPriceProps | null }) {
  const f = summaryFigures(table);
  const money2 = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const link = 'text-accent underline underline-offset-2';
  return (
    <div className="space-y-4">
      <div className="text-[13px] text-ink-2">Study value → today's value, per acre{f.column ? `, ${f.column} year` : ''}</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Figure label="Total cost" p={f.cost} acres={acres} />
        <Figure label="Gross returns" p={f.gross} acres={acres} />
        <Figure label="Net returns above total cost" p={f.net} acres={acres} />
      </div>
      {price && <div className="text-[13px] text-ink-2">
        <label htmlFor="your-price" className="block font-medium text-ink-2 mb-1">Your price</label>
        <span className="flex flex-wrap items-center gap-1">
          <span>$</span>
          <LineInput id="your-price" label={`Your sale price per ${price.unit}`} value={price.value} original={price.original} base={price.base} edited={price.edited} money onChange={price.onChange} />
          <span>per {price.unit}</span>
          {price.edited && price.base != null && <button type="button" className={cn(link, 'ml-2 min-h-11 md:min-h-0')} onClick={() => price.onChange(null)}>Use {price.usda ? 'USDA' : 'study'} price ({money2(price.base)})</button>}
        </span>
        <span className="block mt-1 text-[12px]">
          {price.base != null && `${price.usda ? 'USDA-adjusted' : 'Study'} price: ${money2(price.base)} per ${price.unit}. `}
          {price.usda && !price.edited && `${movedText(price.usda)} `}
          {price.where}
        </span>
      </div>}
    </div>
  );
}
