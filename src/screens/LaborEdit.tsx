import type { LaborRates, LaborWage, RepricedRow } from '@/lib/types';
import { LineInput, type View } from './StudyTable';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
const cents = (n: number) => Math.round(n * 100) / 100;

/** An operation's labor under its label: "0.49 hrs at $31.46/hr" with the hours editable where hours x wage reproduce the
 *  study's labor, else the labor dollars. Hidden in the study view and on rows without printed labor. */
export function LaborEdit({ row, view, onOverride }: { row: RepricedRow; view: View; onOverride: (key: string, value: number | null) => void }) {
  const d = row.labor;
  if (!d || view === 'study') return null;
  if (!d.hours || !d.wage) {
    const indexed = cents(d.dollars.original * (row.cells.labor?.autoFactor ?? row.cells.labor?.factor ?? 1));
    return (
      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-ink-2 normal-case" title="The study prints no labor hours that reproduce this labor cost, so the dollars are edited directly.">
        <span>Labor $</span>
        <LineInput id={`edit-${row.id}-labor`} label={`Labor cost per acre for ${row.label}`} value={d.dollars.edited ? d.dollars.current : indexed} original={d.dollars.original} base={indexed} edited={d.dollars.edited} money onChange={v => onOverride(`${row.id}:labor`, v)} />
        <span>per acre</span>
      </span>
    );
  }
  const w = d.wage;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-ink-2 normal-case">
      <LineInput id={`edit-${row.id}-laborHours`} label={`Labor hours per acre for ${row.label}`} value={d.hours.current} original={d.hours.original} edited={d.hours.edited} onChange={v => onOverride(`${row.id}:laborHours`, v)} />
      <span>labor hrs at {money(w.current)}/hr</span>
      {d.machineHrs != null && <span className="text-ink-3">({hrs(d.machineHrs)} hrs machine time x {d.ratio})</span>}
      {view === 'both' && (d.hours.edited || w.edited) && <span className="text-ink-3">(study: {hrs(d.hours.original)} hrs at {money(w.study)}/hr)</span>}
    </span>
  );
}

function WageField({ w, label, onOverride }: { w: LaborWage; label: string; onOverride: (key: string, value: number | null) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span>{label} $</span>
      <LineInput id={`edit-${w.key.replace(':', '-')}`} label={`${label} wage per hour, overhead included`} value={w.edited ? w.current : cents(w.indexed)} original={cents(w.study)} base={cents(w.indexed)} edited={w.edited} money onChange={v => onOverride(w.key, v)} />
      <span>/hr</span>
    </span>
  );
}

/** The study-wide wages per hour, overhead included, for the operations whose labor is hours x wage. Shown only when the
 *  study's wages reproduce its labor (`table.labor` is set). */
export function WageInput({ labor, onOverride }: { labor: LaborRates | null | undefined; onOverride: (key: string, value: number | null) => void }) {
  if (!labor) return null;
  const m = labor.machine, g = labor.general;
  const base = m.overheadPct != null ? ` (${money(m.base)}${g ? ` and ${money(g.base)}` : ''} plus ${m.overheadPct}% overhead${labor.how === 'inferred overhead' ? ', the overhead that reproduces its cost table' : ''})` : '';
  return (
    <div className="text-[13px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <WageField w={m} label="Machine operators" onOverride={onOverride} />
        {g && <WageField w={g} label="General labor" onOverride={onOverride} />}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-ink-2">
        Study: {money(m.study)}{g && ` and ${money(g.study)}`} per hour{base}, moved by the labor index. Used for the {labor.matched} operations whose labor is hours x wage; edit their hours in the table. The other operations keep their labor dollars.
      </p>
    </div>
  );
}
