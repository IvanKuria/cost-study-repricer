import type { LaborRates, LaborWage, RepricedRow } from '@/lib/types';
import { LineInput, type View } from './StudyTable';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
const cents = (n: number) => Math.round(n * 100) / 100;

/** An operation's machine time, editable: fuel, lube and repairs scale with it, and machine labor hours follow it. */
function MachineHours({ row, onOverride }: { row: RepricedRow; onOverride: (key: string, value: number | null) => void }) {
  const m = row.machine!;
  return (
    <span className="flex items-center gap-1" title={`Fuel, lube and repairs are costs per machine hour, so they scale with these hours${m.laborRatio != null ? `; labor hours are machine hours x ${m.laborRatio}` : ''}. Study: ${hrs(m.original)} hrs.`}>
      <LineInput id={`edit-${row.id}-machineHours`} label={`Machine hours per acre for ${row.label}`} value={m.current} original={m.original} edited={m.edited} onChange={v => onOverride(`${row.id}:machineHours`, v)} />
      <span>machine hrs</span>
    </span>
  );
}

/** An operation's time and labor under its label: "0.41 machine hrs", then "0.492 labor hrs at $31.46/hr" with the hours
 *  editable where hours x wage reproduce the study's labor, else the labor dollars. Hidden in the study view and on rows
 *  with neither printed machine time nor printed labor. */
export function LaborEdit({ row, view, onOverride }: { row: RepricedRow; view: View; onOverride: (key: string, value: number | null) => void }) {
  const d = row.labor, m = row.machine;
  if ((!d && !m) || view === 'study') return null;
  const wrap = 'mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2 normal-case';
  const machine = m && <MachineHours row={row} onOverride={onOverride} />;
  if (!d) return <span className={wrap}>{machine}</span>;
  if (!d.hours || !d.wage) {
    const indexed = cents(d.dollars.original * (row.cells.labor?.autoFactor ?? row.cells.labor?.factor ?? 1));
    return (
      <span className={wrap}>
        {machine}
        <span className="flex items-center gap-1" title="The study prints no labor hours that reproduce this labor cost, so the dollars are edited directly.">
          <span>Labor $</span>
          <LineInput id={`edit-${row.id}-labor`} label={`Labor cost per acre for ${row.label}`} value={d.dollars.edited ? d.dollars.current : indexed} original={d.dollars.original} base={indexed} edited={d.dollars.edited} money onChange={v => onOverride(`${row.id}:labor`, v)} />
          <span>per acre</span>
        </span>
      </span>
    );
  }
  const w = d.wage;
  // Labor hours that follow an edited machine time are shown as the base the input resets to, not as a lender edit.
  return (
    <span className={wrap}>
      {machine}
      <span className="flex flex-wrap items-center gap-1">
        <LineInput id={`edit-${row.id}-laborHours`} label={`Labor hours per acre for ${row.label}`} value={d.hours.current} original={d.hours.original} base={d.hours.edited ? undefined : d.hours.current} edited={d.hours.edited} onChange={v => onOverride(`${row.id}:laborHours`, v)} />
        <span>labor hrs at {money(w.current)}/hr</span>
        {m?.laborRatio != null && !d.hours.edited && <span className="hidden md:inline text-ink-3">(machine hrs x {m.laborRatio})</span>}
        {view === 'both' && (d.hours.edited || w.edited || m?.edited) && <span className="text-ink-3">(study: {m?.edited ? `${hrs(m.original)} machine hrs, ` : ''}{hrs(d.hours.original)} labor hrs at {money(w.study)}/hr)</span>}
      </span>
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
