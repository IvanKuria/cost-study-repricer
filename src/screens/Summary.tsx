import type { PublishedPrice, RepricedTable } from '@/lib/types';
import { summaryFigures, type Pair } from '@/lib/summary';
import { movedText } from '@/lib/cropPrices';
import { money, periodLabel } from '@/ui';
import { peakCash } from '@/lib/exportShared';
import { cn } from '@/lib/utils';
import { LineInput } from './StudyTable';

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
  const f = summaryFigures(table), peak = peakCash(table);
  // Studies print the unit as "Lb", "lbs" or "LB"; say it one way.
  if (price) price = { ...price, unit: price.unit.toLowerCase().replace(/^lbs$/, 'lb') };
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
      {/* The rest of the old facts row, in one line: the headline figures above already carry cost per acre and the acres total. */}
      <div className="text-[13px] text-ink-2 tnum space-y-0.5">
        {table.summary.cashPerAcreRepriced != null && <p>Cash cost: {money(table.summary.cashPerAcreRepriced)} per acre, operating plus cash overhead.</p>}
        {peak && <p>Peak cash need: {money(peak.value)} per acre, accumulated by the {peak.column}{/^\d/.test(peak.column) ? ' year' : ''}.</p>}
        <p>Repriced to {periodLabel(table.targetPeriod)} from {periodLabel(table.referencePeriod)}.</p>
      </div>
      {price && <div className="text-[13px] text-ink-2">
        <label htmlFor="your-price" className="block font-medium text-ink-2 mb-1">Your price</label>
        <span className="flex flex-wrap items-center gap-1">
          <LineInput id="your-price" label={`Your sale price per ${price.unit}`} value={price.value} original={price.original} base={price.base} edited={price.edited} money dollar onChange={price.onChange} />
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
