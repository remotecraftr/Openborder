import { Crawler, detectShopify } from './crawler';
import { computeScore } from './scoring';
import { LegalPagesModule } from './modules/m1Legal';
import { ConsentTrackingModule } from './modules/m2Consent';
import { LocalizationModule } from './modules/m3Locale';
import { AccessibilityModule } from './modules/m4Axe';
import { TaxDisplayModule } from './modules/m5Tax';
import { MANAGED_BROWSER } from './browser';
import { getAdVolumeByCountry } from './api/adyntel';
import { COUNTRY_TO_CURRENCY } from './currencyMap';
import type { AuditResult, Finding, ErrorRecord } from './types';

export interface AnalyzeOptions {
  /** Include M5 tax-display stretch module (default: false) */
  includeTaxDisplay?: boolean;
  /** Include M4 accessibility scan via Playwright (default: false — use CLI for reliable results) */
  includeAccessibility?: boolean;
  /** Use Playwright to fully render pages before M3 localization checks (default: false — use CLI for JS-rendered currency/locale detection) */
  usePlaywright?: boolean;
}

export interface ProgressEvent {
  type: string;
  message?: string;
  result?: any;
  [key: string]: any;
}

export async function analyze(domain: string, opts: AnalyzeOptions = {}, onProgress?: (event: ProgressEvent) => void): Promise<AuditResult> {
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

  const staticModules = [
    new LegalPagesModule(crawler),
    new ConsentTrackingModule(crawler),
  ];
  const playwrightModules = [
    new LocalizationModule(crawler, { usePlaywright }),
    ...(includeAccessibility ? [new AccessibilityModule(crawler)] : []),
  ];
  const tailModules = [
    ...(includeTaxDisplay ? [new TaxDisplayModule(crawler)] : []),
  ];
  const modules = [...staticModules, ...playwrightModules, ...tailModules];

  const allFindings: Finding[] = [];
  const errors: ErrorRecord[] = [];

  const staticResults = await Promise.allSettled(staticModules.map(m => m.run()));

  // With a managed browser service the browser runs remotely — no local memory pressure,
  // so M3 and M4 can run in parallel. Without it, run sequentially to avoid OOM on serverless.
  let playwrightResults: PromiseSettledResult<Finding[]>[];
  if (MANAGED_BROWSER) {
    playwrightResults = await Promise.allSettled(playwrightModules.map(m => m.run()));
  } else {
    playwrightResults = [];
    for (const m of playwrightModules) {
      playwrightResults.push(await Promise.allSettled([m.run()]).then(r => r[0]));
    }
  }

  const tailResults = await Promise.allSettled(tailModules.map(m => m.run()));
  const adSpendPromise = getAdVolumeByCountry(domain);

  const results = [...staticResults, ...playwrightResults, ...tailResults];

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

  const multiCurrencyPass = allFindings.some(f => f.checkId === 'm3_enabled_currencies' && f.status === 'pass');
  const currencyEvidence = allFindings.find(f => f.checkId === 'm3_enabled_currencies')?.evidence?.value || '';

  let adSpendData: { 
    facebook: { spendByCountry: Record<string, number>; count: number; totalSpend: number; }, 
    google: { spendByCountry: Record<string, number>; count: number; totalSpend: number; } 
  } = { 
    facebook: { spendByCountry: {}, count: 0, totalSpend: 0 }, 
    google: { spendByCountry: {}, count: 0, totalSpend: 0 } 
  };
  try {
    adSpendData = await adSpendPromise;
  } catch (err) {
    errors.push({
      module: 'ad_intelligence',
      checkId: 'adyntel_api_failed',
      message: 'Failed to fetch ad intelligence data',
      detail: String(err),
    });
  }

  const processSpend = (platform: 'facebook' | 'google', adSpend: Record<string, number>) => {
    const platformDisplay = platform === 'facebook' ? 'Meta' : 'Google';
    for (const [country, spend] of Object.entries(adSpend)) {
      if (platform === 'facebook' && spend < 5000) continue; // Only flag if spend is somewhat significant

      let isSupported = multiCurrencyPass;
      let expectedCurrency = COUNTRY_TO_CURRENCY[country];

      if (expectedCurrency && !isSupported) {
        isSupported = currencyEvidence.includes(expectedCurrency);
      }

      if (!isSupported && expectedCurrency) {
        allFindings.push({
          module: 'M3_Currencies',
          checkId: `m3_mismatch_spend_${platform}_${country}`,
          title: `Localization Mismatch - ${platformDisplay} (${country})`,
          status: 'fail',
          severity: 85,
          confidence: 'high',
          evidence: {
            value: platform === 'google'
              ? `Active ${platformDisplay} ads detected in ${country}, but missing supported currency (${expectedCurrency}).`
              : `Active ${platformDisplay} ads detected in ${country} ($${spend.toLocaleString()}), but missing supported currency (${expectedCurrency}).`
          },
          suggestion: `Add ${expectedCurrency} to your localized storefronts to capture conversion from these ads.`
        });
      } else if (spend > 0) {
        allFindings.push({
          module: 'M3_Currencies',
          checkId: `m3_aligned_spend_${platform}_${country}`,
          title: `Ad Spend Aligned - ${platformDisplay} (${country})`,
          status: 'pass',
          severity: 0,
          confidence: 'high',
          evidence: {
            value: platform === 'google' 
              ? `${platformDisplay} ad spend in ${country} is safely supported by localizations.`
              : `${platformDisplay} ad spend in ${country} ($${spend.toLocaleString()}) is safely supported by localizations.`
          },
          suggestion: ''
        });
      }
    }
  };

  processSpend('facebook', adSpendData.facebook.spendByCountry);
  processSpend('google', adSpendData.google.spendByCountry);

  const readinessScore = computeScore(allFindings);

  return {
    domain,
    platform,
    fetchedAt: new Date().toISOString(),
    readinessScore,
    findings: allFindings,
    errors,
    adMetrics: {
      facebook: { 
        count: adSpendData.facebook.count, 
        totalSpend: adSpendData.facebook.totalSpend,
        regions: Object.keys(adSpendData.facebook.spendByCountry)
      },
      google: { 
        count: adSpendData.google.count, 
        totalSpend: adSpendData.google.totalSpend,
        regions: Object.keys(adSpendData.google.spendByCountry)
      },
    }
  };
}
