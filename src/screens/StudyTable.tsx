import { Fragment, useState } from 'react';
import type { RepricedCell, RepricedRow, RepricedTable, Series, StudyPick } from '@/lib/types';
import { fallbackSentence, fmt, fmtHrs } from '@/lib/exportShared';
import { usesFallback } from '@/lib/reprice';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FactorSource } from './FactorSource';
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
      ].filter(Boolean).join(' — ')}
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

export function StudyTable({ table, study, series, view, onOverride, onFactor }: { table: RepricedTable; study: StudyPick | null; series: Series[]; view: View; onFactor: (key: string, value: number | null) => void; onOverride: (key: string, value: number | null) => void }) {
  const isProd = table.layout === 'production';
  const hasTime = table.columns.some(c => c.key === 'timeHrs');
  const cols = table.columns.filter(c => c.key !== 'timeHrs');
  const showTime = isProd && !hasTime;
  const factorColumn = (key: string) => view !== 'study' && (!isProd || key === 'total');
  const columnCount = 1 + ((showTime || hasTime) ? 1 : 0) + cols.length + cols.filter(c => factorColumn(c.key)).length;
  return (
    <div>
        <div className="text-center mb-3">
          <h2 className="text-[15px] font-bold tracking-wide uppercase mt-0.5">{table.title}</h2>
          <div className="text-[13px] text-ink-2">{[study?.region, study?.year].filter(Boolean).join(' - ')}</div>
        </div>
        {!isProd && <p className="mb-2 text-[12px] text-ink-2">Years after planting · USD per acre · — No amount listed in the study{view !== 'study' && ' · Click a cell to edit'}</p>}
        {view !== 'study' && <p className="mb-1 text-[12px] text-ink-2">Adjustment factor × study cost = adjusted cost. A factor of 1.10 means a 10% increase.</p>}
        <p className="mb-3 text-[12px] text-ink-2">{fallbackSentence(table)}{table.summary.fallbackRows > 0 && ' Those rows are tagged CPI fallback.'} Returns are not indexed; type a value in a returns row to update it.</p>
        <div className="overflow-x-auto -mx-1 px-1" role="region" aria-label="Cost table" tabIndex={0}>
        <table className="w-full min-w-[1100px] text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-ink align-bottom">
              <th className="text-left font-normal text-ink-2 py-1 pr-2 md:sticky md:left-0 bg-ground z-10 min-w-[180px]">Operation</th>
              {(showTime || hasTime) && <th className="text-right font-normal text-ink-2 py-1 px-2 whitespace-pre-line">{'Time\n(Hrs/A)'}</th>}
              {cols.map(c => <Fragment key={c.key}>{factorColumn(c.key) && <th className="text-right font-normal text-ink-2 py-1 px-2">{!isProd && `Year ${c.label.match(/\d+/)?.[0] ?? c.label} `}Adjustment factor</th>}<th className="text-right font-normal text-ink-2 py-1 px-2 whitespace-pre-line">{isProd ? c.label.replace(' & ', ' &\n').replace('/ ', '/\n') : `Year ${c.label.match(/\d+/)?.[0] ?? c.label}`}</th></Fragment>)}
            </tr>
          </thead>
          <tbody>
            {table.yieldRow && <tr className="border-b border-line text-ink-2"><td className="py-1 pr-2 md:sticky md:left-0 bg-ground z-10">{table.yieldRow.label}</td>{cols.map((c, i) => <Fragment key={c.key}>{factorColumn(c.key) && <td />}<td className="text-right px-2 tnum">{table.yieldRow!.values[i] == null ? '—' : fmt(table.yieldRow!.values[i])}</td></Fragment>)}</tr>}
            {table.rows.map(r => {
              if (r.kind === 'blank') return <tr key={r.id} className="h-3"><td colSpan={columnCount} /></tr>;
              if (r.kind === 'heading') return <tr key={r.id}><td colSpan={columnCount} className="pt-2 pb-0.5 font-bold">{r.label}</td></tr>;
              const caps = r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'net' || r.kind === 'returns';
              const editable = r.kind === 'operation' || r.kind === 'overheadItem' || r.kind === 'returns' || r.kind === 'interest';
              return (
                <tr key={r.id} className={cn('align-top', (r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'net') && 'border-t border-line-strong', (r.kind === 'total' || r.kind === 'net') && 'font-bold')}>
                  <td className={cn('py-[3px] pr-2 md:sticky md:left-0 bg-ground z-10', caps ? 'uppercase' : 'pl-4')}>
                    {view === 'study' ? r.label : r.displayLabel ?? r.label}
                    {usesFallback(r) && <span className="ml-2 whitespace-nowrap rounded border border-line px-1 text-[11px] text-ink-3" title="No specific index matched this label, so the consumer price index (CPI) reprices it.">CPI fallback</span>}
                    {r.kind === 'returns' && <span className="block text-[11px] leading-snug text-ink-2 normal-case">{returnsHint(r, isProd, view, !!table.yieldRow)}</span>}
                  </td>
                  {(showTime || hasTime) && <td className="py-[3px] px-2 text-right tnum">{fmtHrs(hasTime ? (r.cells.timeHrs?.original ?? r.timeHrs) : r.timeHrs)}</td>}
                  {cols.map(c => {
                    const cell = r.cells[c.key];
                    const factorable = (r.kind === 'operation' || r.kind === 'overheadItem') && cell?.original != null && cell.original > 0 && cell.factor != null;
                    const key = r.kind === 'returns' && !isProd ? `income:${c.key}` : `${r.id}:${c.key}`;
                    return <Fragment key={c.key}>
                      {factorColumn(c.key) && <td className="py-1 px-2 text-right min-w-[110px]">{factorable ? <FactorInput cell={cell} label={`${r.label}, ${c.key}`} source={<FactorSource row={r} column={c.key} table={table} series={series} study={study} />} onChange={value => onFactor(key, value)} /> : '—'}</td>}
                      <td className="py-[3px] px-2 text-right">{editable && !factorable && (!isProd || c.key === 'total') && view !== 'study' ? <YourCost row={r} col={c.key} inline overrideKey={key} onOverride={onOverride} /> : <CellValue cell={cell} view={view} series={series} />}</td>
                    </Fragment>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function returnsHint(row: RepricedRow, isProd: boolean, view: View, hasPrice: boolean): string {
  const missing = Object.values(row.cells).every(c => c.original == null);
  if (view === 'study') return isProd && missing ? 'The study prints no per-acre gross returns.' : 'Not indexed.';
  if (isProd) return missing ? 'The study prints no per-acre gross returns. Type one in to compute net returns.' : 'Not indexed. Type a value to update.';
  return hasPrice ? 'Not indexed. Type a value in any year, or change the sale price per unit above.' : 'Not indexed. Type a value in any year to update.';
}

function FactorInput({ cell, label, source, onChange }: { cell: RepricedCell; label: string; source: React.ReactNode; onChange: (value: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <div className="flex min-w-[140px] flex-wrap items-center justify-end gap-2">
    <input aria-label={`Adjustment factor for ${label}`} type="number" min="0" step="0.01" inputMode="decimal"
      className="w-[78px] h-11 md:h-7 rounded border border-line px-1 text-right text-[16px] md:text-[13px] tnum"
      value={draft ?? (cell.factor ?? 1).toFixed(4)}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { const n = Number(draft); if (draft === '') onChange(null); else if (Number.isFinite(n) && n >= 0 && draft !== (cell.factor ?? 1).toFixed(4)) onChange(n); setDraft(null); } }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    {source}
    {cell.overridden && <button className="min-h-11 md:min-h-7 text-xs text-accent underline" onClick={() => { setDraft(null); onChange(null); }}>Reset</button>}
  </div>;
}
