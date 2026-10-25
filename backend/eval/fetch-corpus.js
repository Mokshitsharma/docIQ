/**
 * Re-download the public eval corpus and regenerate eval/corpus/*.txt.
 *
 *   node eval/fetch-corpus.js
 *
 * The committed .txt snapshots are what `npm run eval` uses, so results are
 * reproducible even if the upstream documents change. This script exists for
 * provenance: it shows exactly where each snapshot came from and how it was
 * converted. eCFR "current" URLs track the live regulation, so a re-fetch at a
 * later date may differ; compare `sha256Text` in SOURCES.json to detect that.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/services/ingestion/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(__dirname, 'corpus');
const ECFR = 'https://www.ecfr.gov/api/renderer/v1/content/enhanced/current';
const US_GOV_PD =
  'Public domain in the United States: work of the U.S. Government (17 U.S.C. § 105).';

export const SOURCES = [
  {
    id: 'far-52-212-4',
    title: 'FAR 52.212-4 Contract Terms and Conditions—Commercial Products and Commercial Services',
    kind: 'contract',
    publisher: 'eCFR (48 CFR 52.212-4)',
    url: `${ECFR}/title-48?part=52&section=52.212-4`,
    format: 'html',
  },
  {
    id: 'far-52-232-25',
    title: 'FAR 52.232-25 Prompt Payment',
    kind: 'contract',
    publisher: 'eCFR (48 CFR 52.232-25)',
    url: `${ECFR}/title-48?part=52&section=52.232-25`,
    format: 'html',
  },
  {
    id: 'hipaa-breach-notification',
    title: 'HIPAA Breach Notification Rule — 45 CFR Part 164 Subpart D',
    kind: 'policy',
    publisher: 'eCFR (45 CFR 164.400–164.414)',
    url: `${ECFR}/title-45?part=164&subpart=D`,
    format: 'html',
  },
  {
    id: 'ethics-gifts',
    title: 'Standards of Ethical Conduct — Gifts From Outside Sources (5 CFR Part 2635 Subpart B)',
    kind: 'policy',
    publisher: 'eCFR (5 CFR 2635.201–2635.206)',
    url: `${ECFR}/title-5?part=2635&subpart=B`,
    format: 'html',
  },
  {
    id: 'nist-csf-2',
    title: 'NIST Cybersecurity Framework (CSF) 2.0 — NIST CSWP 29',
    kind: 'report',
    publisher: 'National Institute of Standards and Technology',
    url: 'https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf',
    format: 'pdf',
  },
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(p|div|h[1-6]|li|tr|br|table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function main() {
  await fs.mkdir(CORPUS, { recursive: true });
  const manifest = [];
  for (const s of SOURCES) {
    const res = await fetch(s.url, { redirect: 'follow', headers: { 'user-agent': 'dociq-eval' } });
    if (!res.ok) throw new Error(`${s.id}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    let text;
    if (s.format === 'pdf') {
      const tmp = path.join(os.tmpdir(), `${s.id}.pdf`);
      await fs.writeFile(tmp, buf);
      const { pages } = await parseDocument(tmp, 'pdf');
      text = pages.map((p) => p.text).join('\n\n');
      await fs.unlink(tmp).catch(() => {});
    } else {
      text = htmlToText(buf.toString('utf8'));
    }
    text = text.replace(/\r/g, '').trim() + '\n';
    const file = `${s.id}.txt`;
    await fs.writeFile(path.join(CORPUS, file), text, 'utf8');
    manifest.push({
      ...s,
      file,
      license: US_GOV_PD,
      retrieved: new Date().toISOString().slice(0, 10),
      sha256Source: sha256(buf),
      sha256Text: sha256(Buffer.from(text, 'utf8')),
      words: text.split(/\s+/).filter(Boolean).length,
    });
    console.log(`${s.id}: ${manifest.at(-1).words} words`);
  }
  await fs.writeFile(path.join(CORPUS, 'SOURCES.json'), JSON.stringify(manifest, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
