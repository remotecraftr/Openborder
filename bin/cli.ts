#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Load environment variables from .env.local if present
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
        // Do not overwrite existing environment variables
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  }
}

import { analyze } from '../src/orchestrator';

async function main() {
  const domain = process.argv[2];
  if (!domain) {
    console.error('Usage: npx ts-node bin/cli.ts <domain>');
    console.error('  e.g. npx ts-node bin/cli.ts allbirds.com');
    process.exit(1);
  }

  console.log(`\nScanning ${domain} ...\n`);

  const result = await analyze(domain, { includeAccessibility: true });

  const label = result.readinessScore >= 80
    ? '✅ Good'
    : result.readinessScore >= 60
    ? '⚠️  Needs work'
    : result.readinessScore >= 40
    ? '🟠 At risk'
    : '🔴 Critical';

  console.log(`Domain:          ${result.domain}`);
  console.log(`Platform:        ${result.platform}`);
  console.log(`Readiness Score: ${result.readinessScore.toFixed(1)}/100  ${label}`);
  console.log(`Fetched at:      ${result.fetchedAt}`);
  console.log(`Requests used:   (see crawler)`);
  console.log('');

  if (result.findings.length) {
    console.log('Findings:');
    for (const f of result.findings) {
      const icon = f.status === 'pass' ? '✅' : f.status === 'warn' ? '⚠️' : f.status === 'fail' ? '❌' : '○';
      console.log(`  ${icon} [${f.status.toUpperCase()}] ${f.title} (sev ${f.severity})`);
      if (f.suggestion) console.log(`       → ${f.suggestion}`);
    }
    console.log('');
  }

  if (result.errors.length) {
    console.log('Errors:');
    for (const e of result.errors) {
      console.log(`  ⚠ ${e.module}/${e.checkId}: ${e.message}`);
    }
    console.log('');
  }

  if (process.argv.includes('--json')) {
    process.stdout.write('\n' + JSON.stringify(result, null, 2) + '\n');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
