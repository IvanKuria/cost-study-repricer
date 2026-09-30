import { useState } from 'react';
import { Button } from '@/ui';
import type { RepricedTable } from '@/lib/types';
import type { ExportMeta } from '@/lib/exportShared';

export function Exports({ table, meta }: { table: RepricedTable; meta: ExportMeta }) {
  const [includeDetails, setIncludeDetails] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `${(meta.study?.commodity ?? 'study').replace(/[^a-z0-9]+/gi, '-')}-${table.targetPeriod}`;
  const run = async (kind: 'pdf' | 'xlsx') => {
    if (busy) return;
    setBusy(kind); setError(null);
    try {
      const { download } = await import('@/lib/exportXlsx');
      if (kind === 'pdf') { const { buildPdf } = await import('@/lib/exportPdf'); download(await buildPdf(table, meta, { includeDetails }), `${base}.pdf`, 'application/pdf'); }
      else { const { buildWorkbook } = await import('@/lib/exportXlsx'); download(await buildWorkbook(table, meta), `${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); }
    finally { setBusy(null); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex w-full min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeDetails} onChange={e => setIncludeDetails(e.target.checked)} />Include full sources and calculations in PDF</label>
      <Button variant="secondary" disabled={busy !== null} onClick={() => void run('pdf')}>{busy === 'pdf' ? 'Building PDF' : 'Download PDF'}</Button>
      <Button variant="secondary" disabled={busy !== null} onClick={() => void run('xlsx')}>{busy === 'xlsx' ? 'Building spreadsheet' : 'Download spreadsheet'}</Button>
      <span className="text-[13px] text-ink-3">Built on this device from the table above.</span>
      {error && <span role="alert" className="text-[13px] text-loss">{error}</span>}
    </div>
  );
}
