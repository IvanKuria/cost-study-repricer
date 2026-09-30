import { useEffect, useMemo, useState } from 'react';
import type { ParsedStudy } from '@/data/studySchema';
import type { RepriceSettings, RepricedTable, Series, StudyPick } from '@/lib/types';
import { DEFAULT_HASH, parseHash, serializeHash, type HashState } from '@/lib/hashState';
import { hasOverrides, type ExportMeta } from '@/lib/exportShared';
import { DEFAULT_MAPPING } from '@/data/mapping';
import { loadStudy, studyPicks } from '@/lib/studies';
import { SERIES } from '@/lib/series';
import { repriceStudy } from '@/lib/reprice';
import { Card, periodLabel } from '@/ui';
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
  const [hash, setHash] = useState<HashState>(() => parseHash(window.location.hash));
  const series: Series[] = SERIES;
  const [study, setStudy] = useState<ParsedStudy | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [view, setView] = useState<View>('today');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setHash(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { const next = serializeHash(hash); if (next !== window.location.hash) history.replaceState(null, '', next || window.location.pathname); }, [hash]);
  useEffect(() => {
    setOverrides({});
    if (!hash.study) { setStudy(null); return; }
    let live = true;
    loadStudy(hash.study).then(s => { if (live) setStudy(s); }).catch(e => setLoadError(String(e)));
    return () => { live = false; };
  }, [hash.study]);

  const periods = useMemo(() => commonPeriods(series), [series]);
  const rateInfo = useMemo(() => latestRate(series), [series]);
  const target = hash.target && periods.includes(hash.target) ? hash.target : periods[0] ?? null;
  const pick: StudyPick | null = picks.find(p => p.id === hash.study) ?? null;

  const settings: RepriceSettings | null = target ? {
    targetPeriod: target, referenceMonth: 6, interestRate: hash.rate ?? rateInfo?.rate ?? null, overrides, mapping: DEFAULT_MAPPING,
  } : null;
  const table: RepricedTable | null = useMemo(() => {
    if (!study || !settings) return null;
    try { return repriceStudy(study, settings, series); } catch (e) { setLoadError(String(e)); return null; }
  }, [study, series, settings?.targetPeriod, settings?.interestRate, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  const rateSource = rateInfo ? `Kansas City Fed operating loans, ${periodLabel(rateInfo.period)}` : 'no rate series loaded';
  const meta: ExportMeta | null = table ? {
    study: pick, series: series.filter(s => s.id === RATE_SERIES || table.summary.coverage.some(c => c.seriesId === s.id) || DEFAULT_MAPPING.some(m => m.seriesId === s.id)),
    interestRate: settings?.interestRate ?? null, interestSource: 'Kansas City Fed operating loan rate', acres: hash.acres, mappingNotes: mappingNotes(DEFAULT_MAPPING, series),
  } : null;
  const dataDate = series.filter(s => s.frequency === 'monthly').map(s => s.lastPeriod).sort().reverse()[0] ?? null;

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
              hasEdits={Object.keys(overrides).length > 0} onResetEdits={() => setOverrides({})}
            />
          </Card>
          {loadError && <p role="alert" className="text-loss text-[14px]">{loadError}</p>}
          {!hash.study && <p className="text-ink-2">Pick a crop and a study. The study's cost table appears here, repriced to the target month, and every line can be edited.</p>}
          {table && meta && (
            <>
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
                  {hasOverrides(table) && <span className="ml-auto text-ink-2">Dotted underline marks a Your Cost edit.</span>}
                </div>
                <StudyTable table={table} study={pick} series={series} view={view}
                  onOverride={(rowId, value) => setOverrides(o => { const n = { ...o }; if (value === null) delete n[rowId]; else n[rowId] = value; return n; })} />
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
