import { Fragment, useState } from 'react';
import type { PublishedPrice, RepricedCell, RepricedRow, RepricedTable, Series, StudyPick } from '@/lib/types';
import { fallbackSentence, fmt, fmtHrs } from '@/lib/exportShared';
import { usesFallback } from '@/lib/reprice';
import { movedText } from '@/lib/cropPrices';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FactorSource } from './FactorSource';
import { LaborEdit } from './LaborEdit';
import { cn } from '@/lib/utils';

export type View = 'today' | 'study' | 'both';

function CellValue({ cell, view, series }: { cell: RepricedCell | undefined; view: View; series: Series[] }) {
  if (!cell) return <span />;
  const main = view === 'study' ? cell.original : cell.repriced;
  if (main === null) return <span className="text-ink-3" title="No amount listed for this year in the study">—</span>;
  const text = fmt(main);
  const neg = (main ?? 0) < 0;
  const body = (
    <span className={cn('tnum', neg && 'text-loss', cell.overridden && 'underline decoration-dotted underline-offset-4')}>
      {text}
      {view === 'both' && cell.original !== null && cell.original !== cell.repriced && <span className="block text-[11px] text-ink-3 leading-tight">{fmt(cell.original)}</span>}
    </span>
  );
  if (cell.original === null) return body;
  const name = series.find(s => s.id === cell.seriesId)?.name ?? (cell.seriesId ?? 'no series');
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="cursor-help">{body}</span></TooltipTrigger>
      <TooltipContent side="top" className="text-[12px] leading-snug max-w-[280px]">
        <div>Study value: {fmt(cell.original)}</div>
        {cell.overridden && <div>{cell.factorOverridden ? `Your factor: ${cell.factor}` : `Your cost: ${fmt(cell.repriced)}`}</div>}
        {cell.factor !== null && cell.seriesId && !cell.overridden && <>
          <div>{name}</div>
          <div>Index {cell.indexFrom?.toFixed(1)} to {cell.indexTo?.toFixed(1)}, factor {cell.factor.toFixed(3)}</div>
        </>}
        {!cell.seriesId && !cell.overridden && <div>{cell.original === cell.repriced ? 'Study value retained' : 'Calculated from the underlying rows'}</div>}
        {cell.note && <div>{cell.note}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

function YourCost({ row, col, overrideKey, inline = false, onOverride }: { row: RepricedRow; col: string; overrideKey: string; inline?: boolean; onOverride: (key: string, value: number | null) => void }) {
  const cell = row.cells[col];
  const [text, setText] = useState<string | null>(null);
  if (!cell) return null;
  const shown = text ?? fmt(cell.repriced);
  return (
    <input
      id={`edit-${row.id}-${overrideKey}-${inline ? 'inline' : 'column'}`}
      aria-label={`Your ${row.kind === 'returns' ? 'income' : 'cost'} for ${row.label}, ${col}`}
      className={cn('w-[88px] px-1.5 text-right tnum text-[13px] rounded border focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 placeholder:text-ink-3', inline ? 'h-11 md:h-[22px] bg-transparent text-[16px] md:text-[13px]' : 'h-11 md:h-7 text-[16px] md:text-[13px] bg-ground', cell.overridden ? 'border-accent bg-accent-soft/40' : inline && row.kind !== 'returns' ? 'border-transparent hover:border-line-strong' : 'border-line', (cell.repriced ?? 0) < 0 && 'text-loss')}
      placeholder={row.kind === 'returns' && cell.original == null ? 'Enter' : '—'}
      title={[
        cell.original == null ? (row.kind === 'returns' ? 'The study prints no amount here. Enter your income.' : 'No amount listed for this year in the study. Enter your cost if applicable.') : `Study: ${fmt(cell.original)}`,
        cell.original != null && cell.seriesId ? `${cell.seriesId}; index ${cell.indexFrom?.toFixed(2)} to ${cell.indexTo?.toFixed(2)}; factor ${cell.factor?.toFixed(4)}` : '',
        cell.note,
      ].filter(Boolean).join('. ')}
      inputMode="decimal"
      value={shown}
      onFocus={() => setText(cell.repriced === null ? '' : String(Math.round(cell.repriced)))}
      onChange={e => { const raw = e.target.value.replace(/,/g, ''); if (/^-?\d*\.?\d*$/.test(raw)) setText(raw); }}
      onBlur={() => {
        if (text === null) return;
        const n = Number(text);
        if (text === '' || !Number.isFinite(n)) onOverride(overrideKey, null);
        else if (cell.repriced === null || Math.round(n) !== Math.round(cell.repriced) || cell.overridden) onOverride(overrideKey, n);
        setText(null);
      }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

/** A quantity or price input on a return line, styled like the inline cost inputs. Typing the default figure back (the
 *  study's, or the USDA-adjusted price when one applies) clears the edit. */
export function LineInput({ id, label, value, original, base, edited, money, onChange }: { id: string; label: string; value: number | null; original: number | null; base?: number | null; edited: boolean; money?: boolean; onChange: (value: number | null) => void }) {
  const [text, setText] = useState<string | null>(null);
  const show = (n: number | null) => n == null ? '' : n.toLocaleString('en-US', money ? { minimumFractionDigits: 2, maximumFractionDigits: 4 } : { maximumFractionDigits: 4 });
  const reset = base ?? original;
  return (
    <input id={id} aria-label={label} inputMode="decimal"
      className={cn('w-[80px] px-1.5 text-right tnum rounded border focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 h-11 md:h-[22px] bg-transparent text-[16px] md:text-[13px]', edited ? 'border-accent bg-accent-soft/40' : 'border-line')}
      title={[original == null ? 'The study prints no figure here.' : `Study: ${show(original)}`, base != null && base !== original ? `USDA-adjusted: ${show(base)}` : ''].filter(Boolean).join('. ')}
      value={text ?? show(value)}
      onFocus={() => setText(value == null ? '' : String(value))}
      onChange={e => { const raw = e.target.value.replace(/[,$]/g, ''); if (/^\d*\.?\d*$/.test(raw)) setText(raw); }}
      onBlur={() => {
        if (text === null) return;
        const n = Number(text);
        if (text === '' || !Number.isFinite(n) || n === reset) { if (edited) onChange(null); }
        else if (n !== value || !edited) onChange(n);
        setText(null);
      }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

/** True when the line's price is the USDA-adjusted price: one applies and the lender has not changed the price or value. */
const usesUsda = (d: NonNullable<RepricedRow['returnLine']>) => !!d.published && !d.price.edited && !d.valueEdited;

/** Where a return line's price comes from: the study price adjusted by USDA's change since the study and any disclaimers, or why the study price is kept. */
function PriceSource({ row }: { row: RepricedRow }) {
  const d = row.returnLine!;
  if (usesUsda(d)) return <>
    <span className="block text-[11px] leading-snug text-ink-2 normal-case">{movedText(d.published!)}</span>
    {d.published!.disclaimers.map(t => <span key={t} className="block text-[11px] leading-snug text-ink-2 normal-case">Note: {t}</span>)}
  </>;
  if (d.kept && !d.price.edited && !d.valueEdited) return <span className="block text-[11px] leading-snug text-ink-2 normal-case">Study price kept: {d.kept}</span>;
  return null;
}

/** Quantity, unit and price of a production return line, editable unless the study view is shown. */
function ReturnLineDetail({ row, view, onOverride }: { row: RepricedRow; view: View; onOverride: (key: string, value: number | null) => void }) {
  const d = row.returnLine!;
  const q = view === 'study' ? d.quantity.original : d.quantity.current;
  const p = view === 'study' ? d.price.original : d.price.current;
  const num = (n: number | null) => n == null ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  const editable = view !== 'study' && d.quantity.original != null && d.price.original != null;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-ink-2 normal-case">
      {editable
        ? <LineInput id={`edit-${row.id}-quantity`} label={`Quantity for ${row.label}, ${d.unit}`} value={q} original={d.quantity.original} edited={d.quantity.edited} onChange={v => onOverride(`${row.id}:quantity`, v)} />
        : <span className="tnum">{num(q)}</span>}
      <span>{d.unit} at $</span>
      {editable
        ? <LineInput id={`edit-${row.id}-price`} label={`Price per ${d.unit} for ${row.label}`} value={p} original={d.price.original} base={d.default} edited={d.price.edited} money onChange={v => onOverride(`${row.id}:price`, v)} />
        : <span className="tnum">{p == null ? '' : p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>}
      <span>per {d.unit}</span>
      {view !== 'study' && usesUsda(d) && <span className="whitespace-nowrap rounded border border-line px-1 text-[11px] text-ink-3" title={d.published!.seriesId}>USDA {d.published!.year}</span>}
      {view === 'both' && (d.quantity.edited || d.price.edited || usesUsda(d)) && <span className="text-ink-3">(study: {num(d.quantity.original)} at ${d.price.original?.toFixed(2)})</span>}
      {d.main && <span className="text-ink-3">Main crop line; its price is also the sale price for the establishment years.</span>}
    </span>
  );
}

/** The establishment sale price, edited in the yield row the way a production return line's price is. */
export interface SalePriceProps {
  value: number; edited: boolean; usda: PublishedPrice | null; studyPrice: number | null; shared: boolean;
  onChange: (value: number | null) => void;
  reset: { label: string; value: null } | null;
  toStudy: { label: string; value: number } | null;
}

/** "Meat Pounds Per Acre" with the price per unit as an input, in the yield row's label cell. */
function YieldPrice({ label, sale }: { label: string; sale: SalePriceProps }) {
  const m = label.match(/^(.*?)\s*@\s*\$[\d,.]+\s*(?:\/|per\s+)\s*([A-Za-z]+)/i);
  const unit = m?.[2] ?? 'unit';
  const usda = !sale.edited ? sale.usda : null;
  return <>
    {m?.[1] ?? label}
    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px]">
      <span>at $</span>
      <LineInput id="sale-price" label={`Sale price per ${unit}`} value={sale.value} original={sale.studyPrice} base={sale.usda?.price ?? sale.studyPrice} edited={sale.edited} money onChange={sale.onChange} />
      <span>per {unit}</span>
      {usda && <span className="whitespace-nowrap rounded border border-line px-1 text-[11px] text-ink-3" title={usda.seriesId}>USDA {usda.year}</span>}
    </span>
  </>;
}

/** Where the sale price comes from, under the yield row across the table: the change since the study, notes, and buttons back to the USDA or study price. */
function YieldPriceNotes({ sale }: { sale: SalePriceProps }) {
  const usda = !sale.edited ? sale.usda : null;
  const link = 'text-accent underline underline-offset-2';
  const parts = [sale.shared ? 'This price is also used for the main return line in mature production.' : '', usda ? movedText(usda) : ''].filter(Boolean).join(' ');
  if (!parts && !usda?.disclaimers.length && !sale.reset && !sale.toStudy) return null;
  return <>
    {parts && <span className="block">{parts}</span>}
    {usda?.disclaimers.map(t => <span key={t} className="block">Note: {t}</span>)}
    {(sale.reset || sale.toStudy) && <span className="block">
      {sale.reset && <button type="button" className={link} onClick={() => sale.onChange(sale.reset!.value)}>{sale.reset.label}</button>}
      {sale.reset && sale.toStudy && ' · '}
      {sale.toStudy && <button type="button" className={link} onClick={() => sale.onChange(sale.toStudy!.value)}>{sale.toStudy.label}</button>}
    </span>}
  </>;
}

export function StudyTable({ table, study, series, view, salePrice = null, onOverride, onFactor }: { table: RepricedTable; study: StudyPick | null; series: Series[]; view: View; salePrice?: SalePriceProps | null; onFactor: (key: string, value: number | null) => void; onOverride: (key: string, value: number | null) => void }) {
  const isProd = table.layout === 'production';
  const hasTime = table.columns.some(c => c.key === 'timeHrs');
  const cols = table.columns.filter(c => c.key !== 'timeHrs');
  const showTime = isProd && !hasTime;
  // Factor columns double the table's width (one per year in the establishment table), so they open on request.
  const [showFactors, setShowFactors] = useState(false);
  // Production edits a factor per cost item (labor, fuel, materials, custom) inside each cell, so it has no factor column;
  // the establishment table keeps one factor column per year.
  const factorColumn = (_key: string) => showFactors && view !== 'study' && !isProd;
  const cellFactor = (key: string) => showFactors && view !== 'study' && isProd && key !== 'total';
  // On a phone the production table shows the operation and its total; the cost columns open on request.
  const [allCols, setAllCols] = useState(false);
  const part = (key: string) => isProd && key !== 'total' && !allCols ? 'hidden md:table-cell' : '';
  const columnCount = 1 +((showTime || hasTime) ? 1 : 0) + cols.length + cols.filter(c => factorColumn(c.key)).length;
  // The yield and its sale price sit with the income, near the bottom, as the return lines do in mature production.
  const firstIncome = table.yieldRow ? table.rows.find(r => r.kind === 'returns')?.id ?? null : null;
  const yieldRows = table.yieldRow && <>
    <tr className="border-b border-line text-ink-2 align-top"><td className="py-1 pr-2 sticky left-0 bg-ground z-10">{salePrice && view !== 'study' ? <YieldPrice label={table.yieldRow.label} sale={salePrice} /> : table.yieldRow.label}</td>{cols.map((c, i) => <Fragment key={c.key}>{factorColumn(c.key) && <td />}<td className="text-right px-2 tnum">{table.yieldRow!.values[i] == null ? '—' : fmt(table.yieldRow!.values[i])}</td></Fragment>)}</tr>
    {salePrice && view !== 'study' && <tr className="border-b border-line"><td colSpan={columnCount} className="py-1 text-[12px] text-ink-2"><YieldPriceNotes sale={salePrice} /></td></tr>}
  </>;
  // Collapsible sections: each heading owns the rows up to the next heading. Collapsed, a section shows its heading and
  // its totals; its detail rows (operations, overhead items, return lines) are hidden. Exports always list every row.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const owner = new Map<string, string>();
  const sections = new Map<string, { details: number; edited: boolean }>();
  let head: string | null = null;
  for (const r of table.rows) {
    if (r.kind === 'heading') { head = r.id; sections.set(r.id, { details: 0, edited: false }); continue; }
    if (!head || !isDetail(r)) continue;
    owner.set(r.id, head);
    const sec = sections.get(head)!;
    sec.details++;
    if (Object.values(r.cells).some(c => c.overridden)) sec.edited = true;
  }
  const collapsible = [...sections].filter(([, s]) => s.details > 0).map(([id]) => id);
  const allOpen = collapsible.every(id => expanded.has(id));
  const toggle = (id: string) => setExpanded(e => { const n = new Set(e); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const renderRow = (r: RepricedRow) => {
              if (r.kind === 'blank') return <tr key={r.id} className="h-3"><td colSpan={columnCount} /></tr>;
              if (r.kind === 'heading') {
                const sec = sections.get(r.id);
                if (!sec?.details) return <tr key={r.id}><td colSpan={columnCount} className="pt-2 pb-0.5 font-bold">{r.label}</td></tr>;
                const open = expanded.has(r.id);
                // The whole heading row is the button, with the action spelled out, so a section reads as something to open.
                return <tr key={r.id}><td colSpan={columnCount} className="pt-2 pb-0.5">
                  <button type="button" aria-expanded={open} onClick={() => toggle(r.id)} className="group sticky left-0 flex w-full max-w-[calc(100vw-5rem)] md:max-w-none items-center gap-2 rounded px-1 -mx-1 text-left min-h-11 md:min-h-8 hover:bg-accent-soft/50">
                    <span className="font-bold">{r.label}</span>
                    {sec.edited && <span className="whitespace-nowrap rounded border border-accent bg-accent-soft/40 px-1 text-[11px] text-accent-deep">edited</span>}
                    <span className="ml-auto whitespace-nowrap rounded-full border border-line px-2.5 py-0.5 text-[12px] text-accent group-hover:border-accent">{open ? 'Hide lines ▴' : `Show ${sec.details} ${sec.details === 1 ? 'line' : 'lines'} ▾`}</span>
                  </button>
                </td></tr>;
              }
              const caps = r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'net' || (r.kind === 'returns' && !r.returnLine);
              const editable = r.kind === 'operation' || r.kind === 'overheadItem' || r.kind === 'returns' || r.kind === 'interest';
              return (
                <tr key={r.id} className={cn('align-top', (r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'net') && 'border-t border-line-strong', (r.kind === 'total' || r.kind === 'net') && 'font-bold')}>
                  <td className={cn('py-[3px] pr-2 sticky left-0 bg-ground z-10', caps ? 'uppercase' : 'pl-4')}>
                    {view === 'study' ? r.label : r.displayLabel ?? r.label}
                    {usesFallback(r) && <span className="ml-2 whitespace-nowrap rounded border border-line px-1 text-[11px] text-ink-3" title="No specific index matched this label, so the consumer price index (CPI) reprices it.">CPI fallback</span>}
                    {r.sourceNote && <span className="block text-[11px] leading-snug text-ink-2">{r.sourceNote}</span>}
                    {r.labor && <LaborEdit row={r} view={view} onOverride={onOverride} />}
                    {r.returnLine && <ReturnLineDetail row={r} view={view} onOverride={onOverride} />}
                    {r.returnLine && view !== 'study' && <PriceSource row={r} />}
                    {r.returnLine && r.page != null && <span className="block text-[11px] leading-snug text-ink-3">{study ? <a className="underline underline-offset-2" href={`${study.url}#page=${r.page}`} target="_blank" rel="noreferrer">Study, page {r.page}</a> : `Study, page ${r.page}`}{r.quote && `: "${r.quote}"`}</span>}
                    {r.kind === 'returns' && <span className="block text-[11px] leading-snug text-ink-2 normal-case">{returnsHint(r, isProd, view, !!table.yieldRow)}</span>}
                    {r.id === 'gross' && r.kind === 'subtotal' && <span className="block text-[11px] leading-snug text-ink-2 normal-case font-normal">{r.cells.total?.overridden ? r.cells.total.note : 'Sum of the return lines above.'}</span>}
                  </td>
                  {(showTime || hasTime) && <td className={cn('py-[3px] px-2 text-right tnum', part('timeHrs'))}>{fmtHrs(hasTime ? (r.cells.timeHrs?.original ?? r.timeHrs) : r.timeHrs)}</td>}
                  {cols.map(c => {
                    const cell = r.cells[c.key];
                    const factorable = (r.kind === 'operation' || r.kind === 'overheadItem') && cell?.original != null && cell.original > 0 && cell.factor != null;
                    const key = r.kind === 'returns' && !isProd ? `income:${c.key}` : `${r.id}:${c.key}`;
                    return <Fragment key={c.key}>
                      {factorColumn(c.key) && <td className="py-1 px-2 text-right min-w-[110px]">{factorable ? <FactorInput cell={cell} label={`${r.label}, ${c.key}`} source={<FactorSource row={r} column={c.key} table={table} series={series} study={study} />} onChange={value => onFactor(key, value)} /> : '—'}</td>}
                      <td className={cn('py-[3px] px-2 text-right', part(c.key))}>{cellFactor(c.key) && factorable
                        ? <div className="flex flex-col items-end gap-1"><CellValue cell={cell} view={view} series={series} /><FactorInput compact cell={cell} label={`${r.label}, ${c.label}`} source={<FactorSource row={r} column={c.key} table={table} series={series} study={study} />} onChange={value => onFactor(key, value)} /></div>
                        : editable && (!factorable || !showFactors) && (!isProd || c.key === 'total') && view !== 'study' ? <YourCost row={r} col={c.key} inline overrideKey={key} onOverride={onOverride} /> : <CellValue cell={cell} view={view} series={series} />}</td>
                    </Fragment>;
                  })}
                </tr>
              );
  };
  return (
    <div>
        <div className="text-center mb-3">
          <h2 className="text-[15px] font-bold tracking-wide uppercase mt-0.5">{table.title}</h2>
          <div className="text-[13px] text-ink-2">{[study?.region, study?.year].filter(Boolean).join(' - ')}</div>
        </div>
        {!isProd && <p className="mb-2 text-[12px] text-ink-2">Years after planting · USD per acre · — No amount listed in the study{view !== 'study' && ' · Click a cell to edit'}</p>}
        {table.establishmentNote && <p className="mb-2 text-[13px] text-ink">{table.establishmentNote}</p>}
        <p className="mb-3 text-[12px] text-ink-2">{fallbackSentence(table)}{table.summary.fallbackRows > 0 && ' Those rows are tagged CPI fallback.'} {table.rows.some(r => r.returnLine?.published) ? 'Returns are not indexed by cost series. Lines marked USDA use the study price times USDA\'s California price ratio (latest year over the study year); the others keep the study price. Change the quantity, price or value of a return line to update it.' : table.rows.some(r => r.returnLine) ? 'Returns are not indexed; change the quantity, price or value of a return line to update it.' : 'Returns are not indexed; type a value in a returns row to update it.'}</p>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
          {collapsible.length > 0 && <button type="button" className="h-11 md:h-8 px-3 rounded-full border border-line text-ink-2 hover:border-accent" onClick={() => setExpanded(allOpen ? new Set() : new Set(collapsible))}>{allOpen ? 'Hide all lines ▴' : 'Show all lines ▾'}</button>}
          {view !== 'study' && <button type="button" aria-pressed={showFactors} className={cn('h-11 md:h-8 px-3 rounded-full border', showFactors ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line text-ink-2 hover:border-accent')} onClick={() => setShowFactors(s => !s)}>{showFactors ? 'Hide adjustment factors' : 'Edit adjustment factors'}</button>}
          {isProd && <button type="button" aria-pressed={allCols} className={cn('md:hidden h-11 px-3 rounded-full border', allCols ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line text-ink-2')} onClick={() => setAllCols(s => !s)}>{allCols ? 'Totals only' : 'Labor, fuel and material columns'}</button>}
          <span className="text-[12px] text-ink-3">{showFactors && view !== 'study' ? 'Adjustment factor × study cost = adjusted cost; 1.10 means a 10% increase.' : allOpen ? 'Every line is shown.' : 'Totals are shown. Open a section to see and edit its lines.'}</span>
        </div>
        <div className="overflow-x-auto -mx-1 px-1" role="region" aria-label="Cost table" tabIndex={0}>
        <table className={cn('w-full text-[13px] border-collapse', showFactors && view !== 'study' && 'min-w-[1100px]')}>
          <thead>
            <tr className="border-b border-ink align-bottom">
              <th className="text-left font-normal text-ink-2 py-1 pr-2 sticky left-0 bg-ground z-10 min-w-[140px] md:min-w-[180px]">Operation</th>
              {(showTime || hasTime) && <th className={cn('text-right font-normal text-ink-2 py-1 px-2 whitespace-pre-line', part('timeHrs'))}>{'Time\n(Hrs/A)'}</th>}
              {cols.map(c => <Fragment key={c.key}>{factorColumn(c.key) && <th className="text-right font-normal text-ink-2 py-1 px-2">{!isProd && `Year ${c.label.match(/\d+/)?.[0] ?? c.label} `}Adjustment factor</th>}<th className={cn('text-right font-normal text-ink-2 py-1 px-2 whitespace-pre-line', part(c.key))}>{isProd ? c.label.replace(' & ', ' &\n').replace('/ ', '/\n') : `Year ${c.label.match(/\d+/)?.[0] ?? c.label}`}</th></Fragment>)}
            </tr>
          </thead>
          <tbody>
            {!firstIncome && yieldRows}
            {table.rows.map(r => <Fragment key={r.id}>{r.id === firstIncome && yieldRows}{(!isDetail(r) || !owner.get(r.id) || expanded.has(owner.get(r.id)!)) && renderRow(r)}</Fragment>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Rows a collapsed section hides: its line items. Headings, subtotals, totals, interest, income and net rows stay. */
const isDetail = (r: RepricedRow) => r.kind === 'operation' || r.kind === 'overheadItem' || (r.kind === 'returns' && !!r.returnLine);

function returnsHint(row: RepricedRow, isProd: boolean, view: View, hasPrice: boolean): string {
  if (row.returnLine) return view === 'study' ? 'Not indexed.' : `${usesUsda(row.returnLine) ? 'Study price x USDA price change' : 'Not indexed'}. Change the quantity or price, or type the value.`;
  const missing = Object.values(row.cells).every(c => c.original == null);
  if (view === 'study') return isProd && missing ? 'The study prints no per-acre gross returns.' : 'Not indexed.';
  if (isProd) return missing ? 'The study prints no per-acre gross returns. Type one in to compute net returns.' : 'Not indexed. Type a value to update.';
  return hasPrice ? 'Each year\'s yield x the sale price per unit above. Type a value in any year, or change the price.' : 'Not indexed. Type a value in any year to update.';
}

/** `compact` is the per-cost-item version inside a production cell: a smaller input under the dollar figure. */
function FactorInput({ cell, label, source, onChange, compact = false }: { cell: RepricedCell; label: string; source: React.ReactNode; onChange: (value: number | null) => void; compact?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <div className={cn('flex items-center justify-end', compact ? 'flex-nowrap gap-1 whitespace-nowrap' : 'flex-wrap min-w-[140px] gap-2')}>
    <input aria-label={`Adjustment factor for ${label}`} type="number" min="0" step="0.01" inputMode="decimal"
      className={cn('h-11 md:h-7 rounded border border-line px-1 text-right text-[16px] tnum', compact ? 'w-[68px] md:h-6 md:text-[12px]' : 'w-[78px] md:text-[13px]', cell.factorOverridden && 'border-accent bg-accent-soft/40')}
      value={draft ?? (cell.factor ?? 1).toFixed(4)}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { const n = Number(draft); if (draft === '') onChange(null); else if (Number.isFinite(n) && n >= 0 && draft !== (cell.factor ?? 1).toFixed(4)) onChange(n); setDraft(null); } }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    {source}
    {cell.overridden && <button className="min-h-11 md:min-h-7 text-xs text-accent underline" onClick={() => { setDraft(null); onChange(null); }}>Reset</button>}
  </div>;
}
