import { changeValue, changeWhere, type UserChange } from '@/lib/exportChanges';
import { EDITED, EditedMark } from '@/ui';
import { cn } from '@/lib/utils';

const KIND_WORDS: Record<UserChange['kind'], string> = {
  cost: 'Cost', income: 'Income', factor: 'Adjustment factor', price: 'Price', quantity: 'Quantity', 'return value': 'Return value',
  'labor hours': 'Labor hours', 'machine hours': 'Machine hours', wage: 'Wage', 'interest rate': 'Interest rate', 'capital recovery rate': 'Capital recovery rate', acres: 'Acres',
};

/** Every edit the lender made, above the table: where it is, what kind, the figure before and after, and a reset for each. */
export function YourChanges({ changes, onReset, onResetAll }: { changes: UserChange[]; onReset: (c: UserChange) => void; onResetAll: () => void }) {
  const link = 'text-accent underline underline-offset-2 hover:text-accent-deep';
  if (!changes.length) return (
    <p className="text-[13px] text-ink-2">
      <span className="font-medium text-ink">Your changes:</span> none yet. Figures you change are tinted and marked <EditedMark className="mx-0.5 align-middle" /> here and in the downloads.
    </p>
  );
  return (
    <section aria-labelledby="your-changes" className="rounded-[var(--radius-ctl)] border border-line">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2">
        <h3 id="your-changes" className="text-[14px] font-semibold">Your changes <span className="tnum font-normal text-ink-3">{changes.length}</span></h3>
        <span className="hidden sm:inline text-[12px] text-ink-3">Tinted and marked <EditedMark className="mx-0.5 align-middle" /> in the table, listed in the PDF and spreadsheet.</span>
        <button type="button" className={cn(link, 'ml-auto min-h-11 md:min-h-0 text-[13px]')} onClick={onResetAll}>Reset all</button>
      </div>
      <ul className="max-h-[280px] overflow-y-auto divide-y divide-line text-[13px]">
        {changes.map(c => (
          <li key={`${c.store}:${c.key}`} className="animate-in fade-in duration-200 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-1.5 sm:grid-cols-[minmax(0,1fr)_150px_minmax(150px,auto)_auto]">
            <span className="min-w-0 truncate" title={changeWhere(c)}>{changeWhere(c)}</span>
            <span className="row-start-2 text-[12px] text-ink-3 sm:row-start-auto">{KIND_WORDS[c.kind]}</span>
            <span className="col-start-2 row-start-1 inline-flex items-center justify-end gap-1.5 tnum whitespace-nowrap sm:col-start-auto sm:row-start-auto">
              <span className="text-ink-3" title={`${c.fromLabel} figure`}>{changeValue(c.from, c.unit)}</span>
              <span aria-hidden className="text-ink-3">to</span>
              <span className={cn('inline-flex items-center gap-1 rounded px-1', EDITED)}><EditedMark />{changeValue(c.to, c.unit)}</span>
            </span>
            <button type="button" className={cn(link, 'hidden sm:block min-h-0 text-[12px]')} onClick={() => onReset(c)} aria-label={`Reset ${KIND_WORDS[c.kind].toLowerCase()} for ${changeWhere(c)}`}>Reset</button>
            <button type="button" className={cn(link, 'sm:hidden col-start-2 row-start-2 justify-self-end min-h-9 text-[12px]')} onClick={() => onReset(c)} aria-label={`Reset ${KIND_WORDS[c.kind].toLowerCase()} for ${changeWhere(c)}`}>Reset</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
