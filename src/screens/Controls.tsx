import { Button, Field, NumberInput, Select, MONTHS, periodLabel } from '@/ui';
import type { StudyPick } from '@/lib/types';

export interface ControlsValue { crop: string | null; study: string | null; target: string | null; rate: number | null; acres: number }

const title = (s: string) => s.replace(/[-–]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function studyLabel(s: StudyPick): string {
  const when = s.priceYear ? `prices as of ${s.priceMonth ? MONTHS[s.priceMonth - 1] + ' ' : ''}${s.priceYear}` : 'price year not stated';
  return `${s.region || 'California'} ${s.year}, ${when}`;
}

export function Controls({ value, onChange, picks, periods, rateDefault, rateSource, hasEdits, onResetEdits }: {
  value: ControlsValue; onChange: (v: ControlsValue) => void; picks: StudyPick[]; periods: string[];
  rateDefault: number | null; rateSource: string; hasEdits: boolean; onResetEdits: () => void;
}) {
  const commodities = [...new Set(picks.map(p => p.commodity))].sort();
  const studies = picks.filter(p => p.commodity === value.crop).sort((a, b) => b.year - a.year || a.region.localeCompare(b.region));
  const rateShown = value.rate ?? rateDefault;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1.6fr_1fr_1fr_0.7fr] items-start">
      <Field label="Crop">
        <Select id="crop" value={value.crop ?? ''} placeholder="Choose a crop" onChange={crop => onChange({ ...value, crop, study: null })}
          options={commodities.map(c => ({ value: c, label: title(c) }))} />
      </Field>
      <Field label="Study">
        <Select id="study" value={value.study ?? ''} placeholder={value.crop ? 'Choose a study' : 'Pick a crop first'} disabled={!value.crop}
          onChange={study => onChange({ ...value, study })}
          options={studies.map(s => ({ value: s.id, label: `${studyLabel(s)}${s.description ? `. ${s.description}` : ''}` }))} />
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
      <div className="flex items-start gap-2">
        <Field label="Acres" className="flex-1">
          <NumberInput id="acres" value={value.acres} step={0.1} onChange={n => onChange({ ...value, acres: n && n > 0 ? n : 1 })} />
        </Field>
      </div>
      {hasEdits && <div className="lg:col-span-5"><Button variant="ghost" className="h-9 px-3 text-[14px]" onClick={onResetEdits}>Reset edits</Button></div>}
    </div>
  );
}
