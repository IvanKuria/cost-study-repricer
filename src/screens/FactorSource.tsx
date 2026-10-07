import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { RepricedCell, RepricedRow, RepricedTable, Series, StudyPick } from '@/lib/types';
import { lookup } from '@/lib/series';
import { CATEGORY_LABEL } from './Notes';

const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 6 });
const money = (value: number | null) => value == null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function SourceDetail({ cell, table, series }: { cell: RepricedCell; table: RepricedTable; series: Series[] }) {
  if (cell.parts) return <div className="space-y-2">{cell.parts.filter(p => p.original != null && p.original !== 0).map((part, i) => <SourceDetail key={i} cell={part} table={table} series={series} />)}</div>;
  const source = series.find(s => s.id === cell.seriesId);
  const from = source && lookup(source, table.referencePeriod);
  const to = source && lookup(source, table.targetPeriod);
  return <div className="space-y-1">
    {source ? <>
      <a href={source.url} target="_blank" rel="noreferrer" className="text-accent underline">{source.name}</a>
      <p className="text-ink-2">{source.source} · {source.unit}</p>
      <p>Study-period index ({from?.period ?? table.referencePeriod}): {number(cell.indexFrom)}</p>
      <p>Target index ({to?.period ?? table.targetPeriod}): {number(cell.indexTo)}</p>
      <p>{number(cell.indexTo)} ÷ {number(cell.indexFrom)} = {number(cell.indexFrom && cell.indexTo != null ? cell.indexTo / cell.indexFrom : null)}</p>
    </> : <p>No index applied; the study amount is retained.</p>}
    <p>Study cost: {money(cell.original)} per acre.</p>
    {cell.note && <p className="text-ink-2">{cell.note}</p>}
    {cell.overridden && <p>Your edit replaces the automatic adjustment for this component.</p>}
  </div>;
}

export function FactorSource({ row, column, table, series, study }: { row: RepricedRow; column: string; table: RepricedTable; series: Series[]; study: StudyPick | null }) {
  const [open, setOpen] = useState(false);
  const cell = row.cells[column];
  const combined = table.layout === 'production' && column === 'total' && row.kind === 'operation';
  const components = combined ? table.columns.filter(c => c.key !== 'total' && c.key !== 'timeHrs' && row.cells[c.key]?.original != null && row.cells[c.key].original !== 0) : [];
  const componentTotal = components.reduce((sum, c) => sum + (row.cells[c.key].repriced ?? 0), 0);
  const automatic = combined && cell.original ? componentTotal / cell.original : cell.autoFactor ?? cell.factor;
  const originalSum = components.reduce((sum, c) => sum + (row.cells[c.key].original ?? 0), 0);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" aria-label={`Adjustment source for ${row.label}, ${column}`} className="inline-flex h-11 w-11 md:h-7 md:w-7 shrink-0 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-accent"><span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current font-serif text-xs font-bold">i</span></button></PopoverTrigger>
    <PopoverContent aria-label={`Adjustment source: ${row.label}`} className="w-[420px] max-w-[calc(100vw-24px)] max-h-[min(600px,80dvh,var(--radix-popover-content-available-height))] overflow-y-auto bg-ground p-4 text-left text-[13px] font-normal text-ink" collisionPadding={12}>
      <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{row.label}</h3><button type="button" aria-label="Close adjustment source" onClick={() => setOpen(false)} className="min-h-7 px-2 text-ink-2">Close</button></div>
      <p>Automatic factor: <strong>{number(automatic)}</strong></p>
      {cell.overridden && <p>Your {cell.factorOverridden ? 'factor' : 'cost'} edit is active. Current factor: <strong>{number(cell.factor)}</strong>. Reset restores the automatic calculation.</p>}
      {combined ? <>
        <p>This is a combined factor for the whole operation. Each component uses its own index. Fertilizer rows can differ because their labor, fuel, materials, and custom-work amounts differ.</p>
        <p>{money(componentTotal)} adjusted component costs ÷ {money(cell.original)} study total = {number(automatic)}.</p>
        {Math.abs(originalSum - (cell.original ?? 0)) > 0.001 && <p className="text-ink-2">The printed study total differs from its component sum by {money((cell.original ?? 0) - originalSum)}; the factor uses the printed total.</p>}
        {components.map(c => <section key={c.key} className="border-t border-line pt-2"><h4 className="font-semibold">{c.label}{row.cells[c.key].category ? ` · ${CATEGORY_LABEL[row.cells[c.key].category!]}` : ''}</h4><SourceDetail cell={row.cells[c.key]} table={table} series={series} /></section>)}
        <p className="text-ink-2">Material categories are assigned from the operation label. For mixed jobs, the first recognized purpose selects the material index.</p>
      </> : <>
        {cell.category && <p>Cost category: {CATEGORY_LABEL[cell.category]}.</p>}
        {cell.category === 'establishmentCpi' && <p>The professor's rule: establishment costs are repriced row by row from the study's establishment table. An establishment figure outside that table, such as this one, is repriced with the CPI, all items.</p>}
        <SourceDetail cell={cell} table={table} series={series} />
      </>}
      <p>Adjusted cost: {money(cell.original)} × {number(cell.factor)} = {money(cell.repriced)} per acre.</p>
      <p className="text-ink-2">Displayed values are rounded; calculations use full precision.</p>
      {study && <a className="text-accent underline" href={`${study.url}${row.page ? `#page=${row.page}` : ''}`} target="_blank" rel="noreferrer">Source study{row.page ? `, page ${row.page}` : ''}</a>}
    </PopoverContent>
  </Popover>;
}
