import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { CategoryMapping, RepricedTable, Series, StudyPick } from '@/lib/types';
import { repricingSentence, type ExportMeta } from '@/lib/exportShared';
import { periodLabel } from '@/ui';

export const CATEGORY_LABEL: Record<string, string> = {
  labor: 'Labor', pesticides: 'Pesticides and pest control materials', fertilizer: 'Fertilizer', water: 'Water and irrigation', pollination: 'Pollination',
  custom: 'Custom and contracted services', otherMaterials: 'Other materials and assessments', fuelLubeRepairs: 'Fuel, lube and repairs',
  operatingInterest: 'Operating interest', cashOverhead: 'Cash overhead', nonCashOverhead: 'Non-cash overhead and capital recovery',
};

export function mappingNotes(mapping: CategoryMapping[], series: Series[]) {
  return mapping.map(m => ({ label: CATEGORY_LABEL[m.category] ?? m.category, series: series.find(s => s.id === m.seriesId)?.name ?? m.seriesId, note: m.note }));
}

export function Notes({ table, meta, study, mapping, series }: { table: RepricedTable; meta: ExportMeta; study: StudyPick | null; mapping: CategoryMapping[]; series: Series[] }) {
  const shares = new Map<string, number>();
  for (const c of table.summary.coverage) shares.set(c.category, (shares.get(c.category) ?? 0) + c.share);
  return (
    <div className="space-y-4 text-[14px] leading-relaxed max-w-[86ch]">
      <p>{repricingSentence(table, meta)}</p>
      {!!table.notes?.length && <Collapsible><CollapsibleTrigger className="font-medium text-accent underline underline-offset-2">Calculation notes and study discrepancies ({table.notes.length})</CollapsibleTrigger><CollapsibleContent><ul className="list-disc pl-5 space-y-2 mt-2">{table.notes.map(n => <li key={n}>{n}</li>)}</ul></CollapsibleContent></Collapsible>}
      <Collapsible>
        <CollapsibleTrigger className="font-medium text-accent underline underline-offset-2">How each line was repriced</CollapsibleTrigger>
        <CollapsibleContent>
          <div className="overflow-x-auto"><table className="mt-2 w-full text-[13px]">
            <thead><tr className="text-left text-ink-2 border-b border-line"><th className="py-1 pr-3 font-medium">Cost category</th><th className="py-1 pr-3 font-medium">Share of this study</th><th className="py-1 pr-3 font-medium">Series</th><th className="py-1 font-medium">Why</th></tr></thead>
            <tbody>
              {mapping.map(m => (
                <tr key={m.category} className="border-b border-line align-top">
                  <td className="py-1.5 pr-3">{CATEGORY_LABEL[m.category] ?? m.category}</td>
                  <td className="py-1.5 pr-3 tnum">{shares.has(m.category) ? `${Math.round((shares.get(m.category) ?? 0) * 100)}%` : ''}</td>
                  <td className="py-1.5 pr-3">{series.find(s => s.id === m.seriesId)?.name ?? m.seriesId}</td>
                  <td className="py-1.5 text-ink-2">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </CollapsibleContent>
      </Collapsible>
      <div>
        <div className="font-medium mb-1">Sources</div>
        <ul className="space-y-1 text-[13px] text-ink-2">
          {study && <li>Source study: UC Davis, {study.title}, {study.region}, {study.year}. <a className="text-accent underline underline-offset-2" href={study.url} target="_blank" rel="noreferrer">PDF</a></li>}
          {series.map(s => <li key={s.id}>{s.name}: {s.source}, {s.unit}, latest {periodLabel(s.lastPeriod)}.{s.url && <> <a className="text-accent underline underline-offset-2" href={s.url} target="_blank" rel="noreferrer">source</a></>}</li>)}
        </ul>
      </div>
    </div>
  );
}
