import { useEffect, useMemo, useState } from 'react';
import type { ParsedStudy } from '@/data/studySchema';
import type { RepriceSettings, RepricedTable, Series, StudyPick } from '@/lib/types';
import { DEFAULT_HASH, parseHash, serializeHash, type HashState } from '@/lib/hashState';
import { hasOverrides, type ExportMeta } from '@/lib/exportShared';
import { DEFAULT_MAPPING } from '@/data/mapping';
import { loadStudy, studyPicks } from '@/lib/studies';
import { SERIES } from '@/lib/series';
import { repriceStudy, studySalePrice } from '@/lib/reprice';
import { Card, NumberInput, Field, periodLabel } from '@/ui';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Controls } from '@/screens/Controls';
import { Facts } from '@/screens/Facts';
import { StudyTable, type View } from '@/screens/StudyTable';
import { Notes, mappingNotes } from '@/screens/Notes';
import { Exports } from '@/screens/Exports';

const RATE_SERIES = 'kcfed.operatingRate';

/** Months every monthly series covers, newest first, from 2010 on. */
export function commonPeriods(series: Series[]): string[] {
  const monthly = series.filter(s => s.frequency === 'monthly');
  if (!monthly.length) return [];
  const sets = monthly.map(s => new Set(Object.keys(s.values)));
  return [...sets[0]].filter(p => p >= '2010-01' && sets.every(set => set.has(p))).sort().reverse();
}

function latestRate(series: Series[]): { rate: number; period: string } | null {
  const s = series.find(x => x.id === RATE_SERIES);
  if (!s) return null;
  const v = s.values[s.lastPeriod];
  if (!Number.isFinite(v)) return null;
  return { rate: s.unit === 'percent' ? v / 100 : v, period: s.lastPeriod };
}

export default function App() {
  const picks = useMemo(() => studyPicks(), []);
  const [hash, setHash] = useState<HashState>(() => window.location.hash ? parseHash(window.location.hash) : { ...DEFAULT_HASH, crop: 'almonds', study: 'almonds-2024-almondssjvsouth-final-draft-8-3-25' });
  const [layout, setLayout] = useState<'establishment' | 'production'>('establishment');
  const [price, setPrice] = useState<number | null>(null);
  const series: Series[] = SERIES;
  const [study, setStudy] = useState<ParsedStudy | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [factorOverrides, setFactorOverrides] = useState<Record<string, number>>({});
  const [view, setView] = useState<View>('today');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setHash(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { const next = serializeHash(hash); if (next !== window.location.hash) history.replaceState(null, '', next || window.location.pathname); }, [hash]);
  useEffect(() => {
    setOverrides({}); setFactorOverrides({}); setPrice(null); setLoadError(null); setStudy(null);
    if (!hash.study) { setStudy(null); return; }
    let live = true;
    loadStudy(hash.study).then(s => { if (live) setStudy(s); }).catch(e => { if (live) setLoadError(String(e)); });
    return () => { live = false; };
  }, [hash.study]);

  const periods = useMemo(() => commonPeriods(series), [series]);
  const rateInfo = useMemo(() => latestRate(series), [series]);
  const target = hash.target && periods.includes(hash.target) ? hash.target : periods[0] ?? null;
  const pick: StudyPick | null = picks.find(p => p.id === hash.study) ?? null;
  const defaultPrice = studySalePrice(study);
  const changePrice = (value: number | null) => {
    setPrice(value === defaultPrice ? null : value);
    setOverrides(o => Object.fromEntries(Object.entries(o).filter(([key]) => !key.startsWith('income:'))));
  };

  const settings: RepriceSettings | null = target ? {
    layout, factorOverrides,  pricePerUnit: price, targetPeriod: target, referenceMonth: 6, interestRate: hash.rate ?? rateInfo?.rate ?? null, overrides, mapping: DEFAULT_MAPPING,
  } : null;
  const calculation = useMemo<{ table: RepricedTable | null; error: string | null }>(() => {
    if (!study || !settings || study.source.id !== hash.study) return { table: null, error: null };
    try { return { table: repriceStudy(study, settings, series), error: null }; } catch (e) { return { table: null, error: String(e) }; }
  }, [study, series, settings?.targetPeriod, settings?.interestRate, overrides, factorOverrides, layout, price, hash.study]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = calculation.table;
  const usedSeries = new Set(table?.rows.flatMap(r => Object.values(r.cells).flatMap(c => c.seriesId?.split('+') ?? [])) ?? []);
  const rateSource = rateInfo ? `Kansas City Fed operating loans, ${periodLabel(rateInfo.period)}` : 'no rate series loaded';
  const meta: ExportMeta | null = table ? {
    sourcesUrl: (() => { const url = new URL(window.location.href); url.searchParams.set('section', 'sources'); return url.href; })(),
    study: pick, series: series.filter(s => s.id === RATE_SERIES || usedSeries.has(s.id)),
    interestRate: settings?.interestRate ?? null, interestSource: hash.rate === null ? rateSource : 'lender-entered rate', acres: hash.acres, mappingNotes: mappingNotes(DEFAULT_MAPPING, series),
  } : null;
  const dataDate = series.filter(s => s.frequency === 'monthly').map(s => s.lastPeriod).sort().reverse()[0] ?? null;

  if (new URLSearchParams(window.location.search).get('section') === 'sources' && table && meta) return <main className="mx-auto max-w-4xl p-5"><h1 className="text-2xl font-bold mb-4">Sources and calculations</h1><p className="mb-4">Adjustment factor = selected month’s index ÷ study-period index. Adjusted cost = study cost × factor. Automatic production totals combine the adjusted components.</p><Notes table={table} meta={meta} study={pick} mapping={DEFAULT_MAPPING} series={meta.series} /></main>;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-dvh">
        <header className="bg-ground border-b border-line">
          <div className="mx-auto max-w-[1240px] px-5 h-14 flex items-center gap-4">
            <div className="font-bold text-[17px] tracking-tight">Cost study repricer</div>
            <div className="ml-auto text-[13px] text-ink-2 text-right leading-tight">
              {target && <div>Target month: <span className="text-ink font-medium">{periodLabel(target)}</span></div>}
              {dataDate && <div>Series through {periodLabel(dataDate)}</div>}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1240px] px-5 py-6 space-y-6">
          <Card className="p-5">
            <Controls
              value={{ crop: hash.crop, study: hash.study, target, rate: hash.rate, acres: hash.acres }}
              onChange={v => setHash({ ...DEFAULT_HASH, ...v })}
              picks={picks} periods={periods} rateDefault={rateInfo?.rate ?? null} rateSource={rateSource}
              hasEdits={Object.keys(overrides).length > 0 || Object.keys(factorOverrides).length > 0 || price !== null} onResetEdits={() => { setOverrides({}); setFactorOverrides({}); setPrice(null); }}
            />
          </Card>
          {(loadError || calculation.error) && <p role="alert" className="text-loss text-[14px]">{loadError || calculation.error}</p>}
          {!hash.study && <p className="text-ink-2">Pick a crop and a study. The study's cost table appears here, repriced to the target month, and every line can be edited.</p>}
          {table && meta && (
            <>
              {study?.establishment?.table && <div className="flex flex-wrap items-end gap-4">
                <div className="max-w-sm space-y-2">
                  <div className="flex flex-wrap gap-2">{(['establishment', 'production'] as const).map(l => <button key={l} type="button" aria-pressed={table.layout === l} aria-describedby="table-stage-description" onClick={() => { setLayout(l); setOverrides({}); setFactorOverrides({}); }} className={`h-9 px-4 rounded-full border ${table.layout === l ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line'}`}>{l === 'establishment' ? 'Planting & early years' : 'Mature production'}</button>)}</div>
                  <p id="table-stage-description" className="text-[13px] text-ink-3">{table.layout === 'establishment' ? 'Costs and income by year, from planting through early harvests.' : 'Costs and income for one typical year at full production.'}</p>
                </div>
                {table.layout === 'establishment' && table.yieldRow && <Field label="Sale price per unit" hint={<>{table.yieldRow.label}<br />{defaultPrice === null ? 'No unit price stated in the parsed study.' : price === null ? 'Using the study price.' : <button type="button" className="text-accent underline underline-offset-2" onClick={() => changePrice(null)}>Use study price (${defaultPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })})</button>}</>} className="max-w-sm"><NumberInput id="sale-price" value={price ?? defaultPrice} step={0.01} prefix="$" onChange={changePrice} /></Field>}
              </div>}
              <Card className="p-5"><Facts table={table} acres={hash.acres} /></Card>
              <Card className="p-5 space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-ink-2 mr-1">Show</span>
                  {(['today', 'study', 'both'] as View[]).map(v => (
                    <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                      className={`h-8 px-3 rounded-full border ${view === v ? 'border-accent bg-accent-soft text-accent-deep font-medium' : 'border-line text-ink-2'}`}>
                      {v === 'today' ? "Today's dollars" : v === 'study' ? "Study's dollars" : 'Both'}
                    </button>
                  ))}
                  {hasOverrides(table) && <span className="ml-auto text-ink-2">Edited values are marked.</span>}
                </div>
                <StudyTable key={`${table.studyId}-${table.layout}`} table={table} study={pick} series={series} view={view}
                  onFactor={(key, value) => {
                    setFactorOverrides(o => { const n = { ...o }; if (value === null) delete n[key]; else n[key] = value; if (table.layout === 'production' && !key.endsWith(':total')) delete n[`${key.split(':')[0]}:total`]; return n; });
                    setOverrides(o => { const n = { ...o }; delete n[key]; if (key.endsWith(':total')) delete n[key.slice(0, -6)]; else if (table.layout === 'production') { delete n[`${key.split(':')[0]}:total`]; delete n[key.split(':')[0]]; } return n; });
                  }}
                  onOverride={(rowId, value) => { setFactorOverrides(o => { const n = { ...o }; delete n[rowId.includes(':') ? rowId : `${rowId}:total`]; return n; }); setOverrides(o => { const n = { ...o }; if (value === null) delete n[rowId]; else n[rowId] = value; return n; }); }} />
              </Card>
              <Card className="p-5"><Notes table={table} meta={meta} study={pick} mapping={DEFAULT_MAPPING} series={meta.series} /></Card>
              <Card className="p-5"><Exports table={table} meta={meta} /></Card>
            </>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
