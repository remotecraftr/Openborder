#!/usr/bin/env ts-node
/**
 * Manual smoke-test for M1, M2, M3 against a live domain.
 * Usage: npx ts-node --project tsconfig.node.json bin/test-m1-m2-m3.ts <domain>
 */
import fs from 'fs';
import path from 'path';

const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (process.env[key] === undefined) process.env[key] = value;
      }
    }
  }
}

import { Crawler, detectShopify } from '../src/crawler';
import { LegalPagesModule }      from '../src/modules/m1Legal';
import { ConsentTrackingModule } from '../src/modules/m2Consent';
import { LocalizationModule }    from '../src/modules/m3Locale';
import { computeScore }          from '../src/scoring';
import type { Finding }          from '../src/types';

const STATUS_ICON: Record<string, string> = {
  pass:         '✅ PASS',
  warn:         '⚠️  WARN',
  fail:         '❌ FAIL',
  not_detected: '○  N/D ',
  error:        '💥 ERR ',
};

function printFindings(title: string, findings: Finding[]) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
  for (const f of findings) {
    const icon = STATUS_ICON[f.status] ?? f.status;
    const sev  = f.severity > 0 ? ` sev ${f.severity}` : '';
    const conf = `  [${f.confidence}]`;
    console.log(`${icon}${sev}${conf}  ${f.title}`);
    if (f.evidence?.value) console.log(`        evidence: ${f.evidence.value}`);
    if (f.evidence?.snippet) console.log(`        snippet:  ${f.evidence.snippet.slice(0, 120)}`);
    if (f.suggestion) console.log(`        → ${f.suggestion.slice(0, 160)}`);
  }
}

async function main() {
  const domain = process.argv[2];
  if (!domain) {
    console.error('Usage: npx ts-node --project tsconfig.node.json bin/test-m1-m2-m3.ts <domain>');
    process.exit(1);
  }

  console.log(`\n🔍 Scanning ${domain} (M1 + M2 + M3 only)\n`);

  const crawler = new Crawler(domain);
  await crawler.init();

  // Reachability check
  try {
    await crawler.get('/');
  } catch (err) {
    console.error(`Cannot reach ${domain}: ${err}`);
    process.exit(1);
  }

  const platform = (await detectShopify(crawler)) ? 'shopify' : 'unknown';
  console.log(`Platform: ${platform}`);

  const [m1Findings, m2Findings, m3Findings] = await Promise.all([
    new LegalPagesModule(crawler).run(),
    new ConsentTrackingModule(crawler).run(),
    new LocalizationModule(crawler, { usePlaywright: true }).run(),
  ]);

  printFindings('M1 — Legal Pages', m1Findings);
  printFindings('M2 — Consent & Tracking', m2Findings);
  printFindings('M3 — Localization Surface', m3Findings);

  const allFindings = [...m1Findings, ...m2Findings, ...m3Findings];
  const score = computeScore(allFindings);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  M1+M2+M3 combined score: ${score.toFixed(1)} / 100`);
  console.log(`  Findings: ${allFindings.length} total`);
  console.log(`    pass:         ${allFindings.filter(f => f.status === 'pass').length}`);
  console.log(`    warn:         ${allFindings.filter(f => f.status === 'warn').length}`);
  console.log(`    fail:         ${allFindings.filter(f => f.status === 'fail').length}`);
  console.log(`    not_detected: ${allFindings.filter(f => f.status === 'not_detected').length}`);
  console.log(`    error:        ${allFindings.filter(f => f.status === 'error').length}`);
  console.log('═'.repeat(60));

  if (process.argv.includes('--json')) {
    console.log('\n' + JSON.stringify({ domain, platform, score, findings: allFindings }, null, 2));
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
