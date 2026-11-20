import { Field, NumberInput, Select, MONTHS, periodLabel } from '@/ui';
import type { StudyPick } from '@/lib/types';
import { CONTENTS_LABEL, type StudyChoice } from '@/lib/studies';
import type { Layout } from '@/lib/hashState';
import { cn } from '@/lib/utils';

export interface ControlsValue { layout: Layout; crop: string | null; study: string | null; target: string | null; rate: number | null; crRate: number | null; acres: number }

const title = (s: string) => s.replace(/[-–]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function studyLabel(s: StudyPick): string {
  const when = s.priceYear ? `prices as of ${s.priceMonth ? MONTHS[s.priceMonth - 1] + ' ' : ''}${s.priceYear}` : 'price year not stated';
  return `${s.region || 'California'} ${s.year}, ${when}`;
}

export const LAYOUT_LABEL: Record<Layout, string> = { establishment: 'Establishment', production: 'Mature production' };
const MISSING: Record<Layout, string> = { establishment: 'No establishment table in this study.', production: 'No mature production table in this study.' };
const ABOUT: Record<Layout, string> = { establishment: 'Costs and income by year, from planting through early harvests.', production: 'Costs and income for one typical year at full production.' };

/** Whether a study holds the table for a layout, read from the studyContents manifest. */
export const hasLayout = (s: StudyChoice, layout: Layout) => layout === 'establishment' ? s.hasEstablishment : s.hasProduction;

/** The table toggle decides the layout. Switching keeps the study when it has the other table; otherwise the study
 *  clears, and the crop too when it has no study of that kind. */
export function switchLayout(value: ControlsValue, layout: Layout, picks: StudyChoice[]): ControlsValue {
  const study = picks.find(p => p.id === value.study);
  if (study && hasLayout(study, layout)) return { ...value, layout };
  const cropFits = picks.some(p => p.commodity === value.crop && hasLayout(p, layout));
  return { ...value, layout, study: null, crRate: null, crop: cropFits ? value.crop : null };
}

export function Controls({ value, onChange, picks, periods, rateDefault, rateSource }: {
  value: ControlsValue; onChange: (v: ControlsValue) => void; picks: StudyChoice[]; periods: string[];
  rateDefault: number | null; rateSource: string;
}) {
  const current = picks.find(p => p.id === value.study) ?? null;
  // Crops and studies of the chosen kind; the crop or study already chosen stays listed so the select never goes blank.
  const commodities = [...new Set(picks.filter(p => hasLayout(p, value.layout) || p.commodity === value.crop).map(p => p.commodity))].sort();
  const studies = picks.filter(p => p.commodity === value.crop && (hasLayout(p, value.layout) || p.id === value.study)).sort((a, b) => b.year - a.year || a.region.localeCompare(b.region));
  const missing = current ? (['establishment', 'production'] as const).find(l => !hasLayout(current, l)) ?? null : null;
  const rateShown = value.rate ?? rateDefault;
  // One fixed line of six fields on a laptop. The capital recovery rate, which only some mature production tables use,
  // sits with the wages below (CapitalRecoveryField) so the line never reflows when the study changes.
  return (
    <div className="grid gap-4 items-start sm:grid-cols-2 lg:grid-cols-[auto_minmax(9.5rem,1fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.55fr)]">
      <Field label="Table" hint={missing ? MISSING[missing] : undefined}>
        <div id="layout" role="group" className="inline-flex h-10 w-full sm:w-auto rounded-[var(--radius-ctl)] bg-well p-[3px]">
          {(['establishment', 'production'] as const).map(l => {
            const unavailable = l === missing;
            return <button key={l} type="button" aria-pressed={value.layout === l} title={unavailable ? `${MISSING[l]} Choosing it clears the study.` : ABOUT[l]}
              onClick={() => { if (l !== value.layout) onChange(switchLayout(value, l, picks)); }}
              className={cn('flex-1 sm:flex-none px-3 rounded-[8px] text-[14px] whitespace-nowrap transition-colors duration-150',
                value.layout === l ? 'bg-ground text-ink font-medium shadow-[0_1px_2px_rgba(20,22,25,0.12)]' : unavailable ? 'text-ink-3 hover:text-ink-2' : 'text-ink-2 hover:text-ink')}>
              {LAYOUT_LABEL[l]}
            </button>;
          })}
        </div>
      </Field>
      <Field label="Crop">
        <Select id="crop" value={value.crop ?? ''} placeholder="Choose a crop" onChange={crop => onChange({ ...value, crop, study: null, crRate: null })}
          options={commodities.map(c => ({ value: c, label: title(c) }))} />
      </Field>
      {/* Each study's quiet second line says which tables it holds, so studies with both are easy to find. */}
      <Field label="Study">
        <Select id="study" value={value.study ?? ''} placeholder={value.crop ? 'Choose a study' : 'Pick a crop first'} disabled={!value.crop || !studies.length}
          onChange={study => onChange({ ...value, study, crRate: null })}
          options={studies.map(s => ({ value: s.id, label: `${studyLabel(s)}${s.description ? `. ${s.description}` : ''}`, detail: CONTENTS_LABEL[s.contents] }))} />
      </Field>
      <Field label="Target month">
        <Select id="target" value={value.target ?? ''} placeholder="Latest" onChange={target => onChange({ ...value, target })}
          options={periods.map(p => ({ value: p, label: periodLabel(p) }))} />
      </Field>
      <Field label="Interest rate" hint={value.rate === null
        ? <span>{rateSource}. <button type="button" className="text-accent underline underline-offset-2" onClick={() => onChange({ ...value, rate: rateDefault })}>Edit</button></span>
        : <button type="button" className="text-accent underline underline-offset-2" onClick={() => onChange({ ...value, rate: null })}>Use the default rate</button>}>
        <NumberInput id="rate" value={rateShown === null ? null : Math.round(rateShown * 10000) / 100} step={0.01} suffix="%" onChange={n => onChange({ ...value, rate: n === null ? null : n / 100 })} />
      </Field>
      <Field label="Acres">
        <NumberInput id="acres" value={value.acres} step={0.1} onChange={n => onChange({ ...value, acres: n && n > 0 ? n : 1 })} />
      </Field>
    </div>
  );
}

/** The yearly rate behind the establishment charge, shown for mature production tables that recalculate it. */
export function CapitalRecoveryField({ value, onChange, crRateDefault, crRateSource, className }: {
  value: ControlsValue; onChange: (v: ControlsValue) => void; crRateDefault: number; crRateSource: string; className?: string;
}) {
  const crShown = value.crRate ?? crRateDefault;
  return (
    <Field label="Capital recovery rate" className={className} hint={value.crRate === null
      ? <span>{crRateSource}. <button type="button" className="text-accent underline underline-offset-2" onClick={() => onChange({ ...value, crRate: crRateDefault })}>Edit</button></span>
      : <button type="button" className="text-accent underline underline-offset-2" onClick={() => onChange({ ...value, crRate: null })}>Use the default rate</button>}>
      <NumberInput id="cr-rate" value={Math.round(crShown * 10000) / 100} step={0.01} suffix="%" onChange={n => onChange({ ...value, crRate: n === null ? null : n / 100 })} />
    </Field>
  );
}
