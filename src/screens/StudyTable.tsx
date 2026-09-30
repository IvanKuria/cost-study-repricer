import { useState } from 'react';
import type { RepricedCell, RepricedRow, RepricedTable, Series, StudyPick } from '@/lib/types';
import { fmt, fmtHrs } from '@/lib/exportShared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type View = 'today' | 'study' | 'both';

function CellValue({ cell, view, series }: { cell: RepricedCell | undefined; view: View; series: Series[] }) {
  if (!cell) return <span />;
  const main = view === 'study' ? cell.original : cell.repriced;
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
        {cell.overridden && <div>Your Cost: {fmt(cell.repriced)}</div>}
        {cell.factor !== null && !cell.overridden && <>
          <div>{name}</div>
          <div>Index {cell.indexFrom?.toFixed(1)} to {cell.indexTo?.toFixed(1)}, factor {cell.factor.toFixed(3)}</div>
        </>}
        {cell.factor === null && !cell.overridden && <div>Not repriced</div>}
      </TooltipContent>
    </Tooltip>
  );
}

function YourCost({ row, col, overrideKey, onOverride }: { row: RepricedRow; col: string; overrideKey: string; onOverride: (key: string, value: number | null) => void }) {
  const cell = row.cells[col];
  const [text, setText] = useState<string | null>(null);
  if (!cell) return null;
  const shown = text ?? (cell.repriced === null ? '' : String(Math.round(cell.repriced)));
  return (
    <input
      aria-label={`Your cost for ${row.label}`}
      className={cn('w-[88px] h-7 px-1.5 text-right tnum text-[13px] rounded border bg-ground focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25', cell.overridden ? 'border-accent bg-accent-soft/40' : 'border-line')}
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

export function StudyTable({ table, study, series, view, onOverride }: { table: RepricedTable; study: StudyPick | null; series: Series[]; view: View; onOverride: (key: string, value: number | null) => void }) {
  const isProd = table.layout === 'production';
  const totalCol = isProd ? 'total' : table.columns[table.columns.length - 1]?.key;
  const hasTime = table.columns.some(c => c.key === 'timeHrs');
  const cols = table.columns.filter(c => c.key !== 'timeHrs');
  const showTime = isProd && !hasTime;
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="min-w-[860px]">
        <div className="text-center mb-3">
          <div className="text-[11px] tracking-wide text-ink-2">UC COOPERATIVE EXTENSION</div>
          <h2 className="text-[15px] font-bold tracking-wide uppercase mt-0.5">{table.title}</h2>
          <div className="text-[13px] text-ink-2">{[study?.region, study?.year].filter(Boolean).join(' - ')}</div>
        </div>
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-ink align-bottom">
              <th className="text-left font-normal text-ink-2 py-1 pr-2 w-[38%]">Operation</th>
              {(showTime || hasTime) && <th className="text-right font-normal text-ink-2 py-1 px-2 whitespace-pre-line">{'Time\n(Hrs/A)'}</th>}
              {cols.map(c => <th key={c.key} className="text-right font-normal text-ink-2 py-1 px-2 whitespace-pre-line">{c.label.replace(' & ', ' &\n').replace('/ ', '/\n')}</th>)}
              <th className="text-right font-normal text-ink-2 py-1 pl-2 whitespace-pre-line">{'Your\nCost'}</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map(r => {
              if (r.kind === 'blank') return <tr key={r.id} className="h-3"><td colSpan={cols.length + 3} /></tr>;
              if (r.kind === 'heading') return <tr key={r.id}><td colSpan={cols.length + 3} className="pt-2 pb-0.5 font-bold">{r.label}</td></tr>;
              const caps = r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'net' || r.kind === 'returns';
              const editable = r.kind === 'operation' || r.kind === 'overheadItem';
              return (
                <tr key={r.id} className={cn('align-top', (r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'net') && 'border-t border-line-strong', (r.kind === 'total' || r.kind === 'net') && 'font-bold')}>
                  <td className={cn('py-[3px] pr-2', caps ? 'uppercase' : 'pl-4')}>{r.label}</td>
                  {(showTime || hasTime) && <td className="py-[3px] px-2 text-right tnum">{fmtHrs(hasTime ? (r.cells.timeHrs?.original ?? r.timeHrs) : r.timeHrs)}</td>}
                  {cols.map(c => <td key={c.key} className="py-[3px] px-2 text-right">{<CellValue cell={r.cells[c.key]} view={view} series={series} />}</td>)}
                  <td className="py-[2px] pl-2 text-right">{editable && totalCol ? <YourCost row={r} col={totalCol} overrideKey={isProd ? r.id : `${r.id}:${totalCol}`} onOverride={onOverride} /> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
