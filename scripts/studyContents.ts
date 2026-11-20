// Writes src/lib/studyContents.json: what each parsed study holds, read from the parsed data rather than the index flags
// (the index's hasEstablishment is set for some studies whose establishment table did not parse).
//   e: an establishment table with years and rows, the "Planting & early years" layout
//   p: production operations, or a printed operating total, the "Mature production" layout
// Run after syncing studies: npx tsx scripts/studyContents.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { studyContentsOf } from '../src/lib/studyContentsOf';

const dir = join(import.meta.dirname, '../data/studies/parsed');
const out: Record<string, { e: boolean; p: boolean }> = {};
for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  out[f.replace(/\.json$/, '')] = studyContentsOf(JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
writeFileSync(join(import.meta.dirname, '../src/lib/studyContents.json'), JSON.stringify(out, null, 0).replace(/},"/g, '},\n"') + '\n');
console.log(`${Object.keys(out).length} studies`);
