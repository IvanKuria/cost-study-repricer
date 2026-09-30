import type { RepricedTable } from '@/lib/types';
import { peakCash } from '@/lib/exportShared';
import { money, periodLabel } from '@/ui';

function Fact({ label, value, original, sub }: { label: string; value: string; original?: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="text-[24px] font-semibold tnum leading-tight">{value}</div>
      <div className="text-[13px] text-ink-3 tnum">{original ? `study: ${original}` : sub ?? ''}</div>
    </div>
  );
}

export function Facts({ table, acres }: { table: RepricedTable; acres: number }) {
  const s = table.summary;
  const total = s.totalPerAcreRepriced;
  const peak = peakCash(table);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 border-t border-line pt-4">
      <Fact label={table.summaryColumn ? `${table.summaryColumn} year cost per acre` : "Cost per acre today"} value={total === null ? '' : money(total)} original={s.totalPerAcreOriginal === null ? undefined : money(s.totalPerAcreOriginal)} />
      <Fact label={table.summaryColumn ? `${table.summaryColumn} year cash cost per acre` : "Cash cost per acre today"} value={s.cashPerAcreRepriced === null ? '' : money(s.cashPerAcreRepriced)} sub="operating plus cash overhead" />
      <Fact label={`Total for ${acres.toLocaleString('en-US')} ${acres === 1 ? 'acre' : 'acres'}`} value={total === null ? '' : money(total * acres)} sub={table.summaryColumn ? `${table.summaryColumn} year cost × acres` : "cost per acre times acres"} />
      {peak
        ? <Fact label="Peak cash need per acre" value={money(peak.value)} sub={`accumulated by ${peak.column}`} />
        : <Fact label="Repriced to" value={periodLabel(table.targetPeriod)} sub={`from ${periodLabel(table.referencePeriod)}`} />}
    </div>
  );
}
