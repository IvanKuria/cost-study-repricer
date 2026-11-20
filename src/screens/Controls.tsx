import { Field, NumberInput, Select, MONTHS, periodLabel } from '@/ui';
import type { StudyPick } from '@/lib/types';
import { CONTENTS_LABEL, type StudyChoice } from '@/lib/studies';
import { cn } from '@/lib/utils';

export interface ControlsValue { crop: string | null; study: string | null; target: string | null; rate: number | null; crRate: number | null; acres: number }

const title = (s: string) => s.replace(/[-–]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function studyLabel(s: StudyPick): string {
  const when = s.priceYear ? `prices as of ${s.priceMonth ? MONTHS[s.priceMonth - 1] + ' ' : ''}${s.priceYear}` : 'price year not stated';
  return `${s.region || 'California'} ${s.year}, ${when}`;
}

/** The study filter: any study, or only establishment, or only mature production. A chosen kind also fixes which
 *  table is shown (App), so picking Mature production never shows an establishment table. */
export type ContentsFilter = 'any' | 'establishment' | 'production';
const FILTERS: { key: ContentsFilter; label: string }[] = [
  { key: 'any', label: 'All' }, { key: 'establishment', label: 'Establishment' }, { key: 'production', label: 'Mature production' },
];
export const matchesFilter = (s: StudyChoice, f: ContentsFilter) => f === 'any' || (f === 'establishment' ? s.hasEstablishment : s.hasProduction);

export function Controls({ value, onChange, picks, periods, rateDefault, rateSource, crRateDefault = null, crRateSource = '', filter, onFilterChange }: {
  value: ControlsValue; onChange: (v: ControlsValue) => void; picks: StudyChoice[]; periods: string[];
  rateDefault: number | null; rateSource: string; crRateDefault?: number | null; crRateSource?: string;
  filter: ContentsFilter; onFilterChange: (f: ContentsFilter) => void;
}) {
  const setFilter = onFilterChange;
  // A crop stays listed when it has a study of the chosen kind, or it is the crop already chosen.
  const commodities = [...new Set(picks.filter(p => matchesFilter(p, filter) || p.commodity === value.crop).map(p => p.commodity))].sort();
  const ofCrop = picks.filter(p => !value.crop || p.commodity === value.crop);
  const studies = ofCrop.filter(p => p.commodity === value.crop && (matchesFilter(p, filter) || p.id === value.study)).sort((a, b) => b.year - a.year || a.region.localeCompare(b.region));
  const rateShown = value.rate ?? rateDefault;
  const showCr = crRateDefault !== null;
  const crShown = value.crRate ?? crRateDefault;
  return (
    <div className={`grid gap-4 items-start ${showCr ? 'lg:grid-cols-[1.1fr_1.6fr_1fr_1fr_1fr_0.7fr]' : 'lg:grid-cols-[1.1fr_1.6fr_1fr_1fr_0.7fr]'}`}>
      <Field label="Crop">
        <Select id="crop" value={value.crop ?? ''} placeholder="Choose a crop" onChange={crop => onChange({ ...value, crop, study: null, crRate: null })}
          options={commodities.map(c => ({ value: c, label: title(c) }))} />
      </Field>
      <div className="min-w-0">
        <Field label="Study">
          <Select id="study" value={value.study ?? ''} placeholder={value.crop ? (studies.length ? 'Choose a study' : 'No study of this kind') : 'Pick a crop first'} disabled={!value.crop || !studies.length}
            onChange={study => onChange({ ...value, study, crRate: null })}
            options={studies.map(s => ({ value: s.id, label: `${studyLabel(s)}${s.description ? `. ${s.description}` : ''}`, detail: CONTENTS_LABEL[s.contents] }))} />
        </Field>
        <div role="group" aria-label="Show studies with" className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-ink-3 mr-0.5">Studies with</span>
          {FILTERS.map(f => {
            const n = ofCrop.filter(p => matchesFilter(p, f.key)).length;
            return <button key={f.key} type="button" aria-pressed={filter === f.key} disabled={!n && filter !== f.key} onClick={() => setFilter(f.key)}
              className={cn('min-h-8 md:min-h-6 px-2 rounded-full border transition-colors duration-150 disabled:opacity-40', filter === f.key ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line text-ink-2 hover:border-accent')}>
              {f.label} <span className="tnum text-ink-3">{n}</span>
            </button>;
          })}
        </div>
      </div>
      <Field label="Target month">
        <Select id="target" value={value.target ?? ''} placeholder="Latest" onChange={target => onChange({ ...value, target })}
          options={periods.map(p => ({ value: p, label: periodLabel(p) }))} />
      </Field>
      <Field label="Interest rate" hint={value.rate === null
        ? <span>{rateSource}. <button type="button" className="text-accent underline underline-offset-2" onClick={() => onChange({ ...value, rate: rateDefault })}>Edit</button></span>
        : <button type="button" className="text-accent underline underline-offset-2" onClick={() => onChange({ ...value, rate: null })}>Use the default rate</button>}>
        <NumberInput id="rate" value={rateShown === null ? null : Math.round(rateShown * 10000) / 100} step={0.01} suffix="%" onChange={n => onChange({ ...value, rate: n === null ? null : n / 100 })} />
      </Field>
      {showCr && <Field label="Capital recovery rate" hint={value.crRate === null
        ? <span>{crRateSource}. <button type="button" className="text-accent underline underline-offset-2" onClick={() => onChange({ ...value, crRate: crRateDefault })}>Edit</button></span>
        : <button type="button" className="text-accent underline underline-offset-2" onClick={() => onChange({ ...value, crRate: null })}>Use the default rate</button>}>
        <NumberInput id="cr-rate" value={crShown === null ? null : Math.round(crShown * 10000) / 100} step={0.01} suffix="%" onChange={n => onChange({ ...value, crRate: n === null ? null : n / 100 })} />
      </Field>}
      <div className="flex items-start gap-2">
        <Field label="Acres" className="flex-1">
          <NumberInput id="acres" value={value.acres} step={0.1} onChange={n => onChange({ ...value, acres: n && n > 0 ? n : 1 })} />
        </Field>
      </div>
    </div>
  );
}
