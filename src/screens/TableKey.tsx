import { useId, useState } from 'react';
import type { RepricedTable } from '@/lib/types';

/** A quiet key above the cost table: one line per column (or kind of row, in the establishment table), with the study's
 *  own sentence and page where the parsed text has one. Closed by default. */
export function TableKey({ table }: { table: RepricedTable }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const entries = table.columnKey ?? [];
  if (!entries.length) return null;
  return (
    <div className="mb-2 text-[13px]">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}
        className="min-h-11 md:min-h-7 text-accent underline underline-offset-2">
        {open ? 'Hide what the columns mean' : table.layout === 'establishment' ? 'What the columns and rows mean' : 'What the columns mean'}
      </button>
      <div id={id} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`} inert={!open}>
        <div className="overflow-hidden max-w-[86ch]">
          <dl className="mt-1 space-y-1.5 border-l-2 border-line pl-3 pb-1">
            {entries.map(e => (
              <div key={e.column} className="leading-snug">
                <dt className="inline font-medium">{e.column}: </dt>
                <dd className="inline text-ink-2">
                  {e.text}
                  {e.source && <span className="block text-[12px] text-ink-3">Study, page {e.source.page}: “{e.source.quote}”</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
