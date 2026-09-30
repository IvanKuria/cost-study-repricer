// Copies the parsed UC cost studies from the sibling farmer-app repo so both tools share one parser.
import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const src = resolve(process.env.STUDIES_SRC ?? '../cost-return-tool-sf/data/studies/parsed');
const idx = resolve(process.env.STUDIES_INDEX ?? '../cost-return-tool-sf/src/data/studies/index.json');
const schema = resolve(process.env.STUDIES_SCHEMA ?? '../cost-return-tool-sf/src/data/studySchema.ts');
if (!existsSync(src)) throw new Error(`no parsed studies at ${src}`);
mkdirSync('data/studies/parsed', { recursive: true });
cpSync(src, 'data/studies/parsed', { recursive: true });
cpSync(idx, 'data/studies/index.json');
cpSync(schema, 'src/data/studySchema.ts');
console.log(`synced ${readdirSync('data/studies/parsed').length} studies`);
