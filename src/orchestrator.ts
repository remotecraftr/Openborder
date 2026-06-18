import { Crawler, detectShopify } from './crawler';
import { computeScore } from './scoring';
import { LegalPagesModule } from './modules/m1Legal';
import { ConsentTrackingModule } from './modules/m2Consent';
import { LocalizationModule } from './modules/m3Locale';
import { AccessibilityModule } from './modules/m4Axe';
import { TaxDisplayModule } from './modules/m5Tax';
import type { AuditResult, Finding, ErrorRecord } from './types';

export interface AnalyzeOptions {
  /** Include M5 tax-display stretch module (default: false) */
  includeTaxDisplay?: boolean;
  /** Include M4 accessibility scan via Playwright (default: false — use CLI for reliable results) */
  includeAccessibility?: boolean;
  /** Use Playwright to fully render pages before M3 localization checks (default: false — use CLI for JS-rendered currency/locale detection) */
  usePlaywright?: boolean;
}

export async function analyze(domain: string, opts: AnalyzeOptions = {}): Promise<AuditResult> {
  const { includeTaxDisplay = false, includeAccessibility = true, usePlaywright = true } = opts;

  const crawler = new Crawler(domain);
  await crawler.init();

  // Reachability check — bail early with a clear error rather than returning
  // score 100 with every finding in error state.
  try {
    await crawler.get('/');
  } catch (err) {
    throw new Error(`Cannot reach ${domain}: ${String(err)}`);
  }

  const platform = (await detectShopify(crawler)) ? 'shopify' : 'unknown';

  const modules = [
    new LegalPagesModule(crawler),
    new ConsentTrackingModule(crawler),
    new LocalizationModule(crawler, { usePlaywright }),
    ...(includeAccessibility ? [new AccessibilityModule(crawler)] : []),
    ...(includeTaxDisplay ? [new TaxDisplayModule(crawler)] : []),
  ];

  const allFindings: Finding[] = [];
  const errors: ErrorRecord[] = [];

  const results = await Promise.allSettled(modules.map(m => m.run()));

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const mod = modules[i];
    if (res.status === 'fulfilled') {
      allFindings.push(...res.value);
    } else {
      errors.push({
        module: mod.moduleId,
        checkId: `${mod.moduleId}_fatal`,
        message: `Module ${mod.moduleId} threw unexpectedly`,
        detail: String(res.reason),
      });
    }
  }

  const readinessScore = computeScore(allFindings);

  return {
    domain,
    platform,
    fetchedAt: new Date().toISOString(),
    readinessScore,
    findings: allFindings,
    errors,
  };
}
