import * as fs from 'fs';
import * as path from 'path';
import { BaseModule } from './base';
import type { Finding } from '../types';
import { launchBrowser } from '../browser';

// Lazily loaded inside scanPage() so a path error becomes a caught SKIP_FINDING,
// not an import crash. Uses process.cwd() — webpack transforms require.resolve()
// into an internal module ID, breaking fs.readFileSync in the Next.js server bundle.
let _axeSource: string | null = null;
function getAxeSource(): string {
  if (_axeSource) return _axeSource;
  _axeSource = fs.readFileSync(
    path.join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'),
    'utf8',
  );
  return _axeSource;
}

export interface AxeViolation {
  id: string;
  description: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  nodes: { html: string; target: string[] }[];
}

type AxeResult = { violations: AxeViolation[] };

const SKIP_FINDING = (reason: string, suggestion: string): Finding[] => {
  console.error('[m4Axe] SKIP:', reason);
  return [
    {
      module: 'accessibility',
      checkId: 'm4_axe_unavailable',
      title: 'Accessibility (axe-core) — Skipped',
      status: 'error',
      severity: 0,
      confidence: 'high',
      evidence: { value: reason },
      suggestion,
    },
  ];
};

// Pure function — exported for unit testing.
export function buildAxeFinding(
  violations: AxeViolation[],
  url: string,
  checkId: string,
  pageLabel: string,
): Finding {
  if (!violations.length) {
    return {
      module: 'accessibility',
      checkId,
      title: `Accessibility (axe-core) — ${pageLabel}`,
      status: 'pass',
      severity: 0,
      confidence: 'high',
      evidence: { url, value: `axe-core ran full WCAG 2.1 AA audit on ${pageLabel} — 0 violations found` },
      suggestion: '',
      tools: ['axe-core@4.9.0', 'playwright'],
    };
  }

  const critCount     = violations.filter(v => v.impact === 'critical').length;
  const seriousCount  = violations.filter(v => v.impact === 'serious').length;
  const moderateCount = violations.filter(v => v.impact === 'moderate').length;
  const minorCount    = violations.filter(v => v.impact === 'minor').length;
  const total         = violations.length;

  // Severity / status keyed on the single worst impact present
  let severity: number;
  let status: 'fail' | 'warn';
  if      (critCount)     { severity = 78; status = 'fail'; }
  else if (seriousCount)  { severity = 65; status = 'fail'; }
  else if (moderateCount) { severity = 40; status = 'warn'; }
  else                    { severity = 20; status = 'warn'; }

  // Human-readable breakdown
  const parts: string[] = [];
  if (critCount)     parts.push(`${critCount} critical`);
  if (seriousCount)  parts.push(`${seriousCount} serious`);
  if (moderateCount) parts.push(`${moderateCount} moderate`);
  if (minorCount)    parts.push(`${minorCount} minor`);

  // Top issue IDs for suggestion text (critical/serious first)
  const topIds = violations
    .filter(v => v.impact === 'critical' || v.impact === 'serious')
    .slice(0, 3)
    .map(v => v.id);
  const idHint = topIds.length
    ? topIds.join(', ')
    : violations.slice(0, 3).map(v => v.id).join(', ');

  const serious = critCount + seriousCount;
  const suggestion = serious > 0
    ? `axe found ${serious} serious issues (${idHint}) on the ${pageLabel}. Remediate in code — do not use an accessibility overlay widget.`
    : `axe found ${total} accessibility issue(s) (${idHint}) on the ${pageLabel}. Remediate in code — do not use an accessibility overlay widget.`;

  return {
    module: 'accessibility',
    checkId,
    title: `Accessibility (axe-core) — ${pageLabel}`,
    status,
    severity,
    confidence: 'high',
    evidence: { url, value: `${total} violations: ${parts.join(', ')}` },
    suggestion,
    tools: ['axe-core@4.9.0', 'playwright'],
  };
}

export class AccessibilityModule extends BaseModule {
  readonly moduleId = 'accessibility';

  async run(): Promise<Finding[]> {
    try {
      return await this.runAxe();
    } catch (err) {
      return SKIP_FINDING(
        `Playwright failed: ${String(err)}`,
        'Accessibility scan could not complete.',
      );
    }
  }

  private async runAxe(): Promise<Finding[]> {
    const homepageUrl = this.crawler.baseUrl;
    const productUrl  = await this.resolveProductUrl();
    const browser     = await launchBrowser();

    try {
      const homeViolations = await this.scanPage(browser, homepageUrl);
      const findings: Finding[] = [
        buildAxeFinding(homeViolations, homepageUrl, 'm4_axe_homepage', 'Homepage'),
      ];

      if (productUrl) {
        const productViolations = await this.scanPage(browser, productUrl);
        findings.push(buildAxeFinding(productViolations, productUrl, 'm4_axe_product', 'Product Page'));
      }

      return findings;
    } finally {
      await browser.close();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async scanPage(browser: any, url: string): Promise<AxeViolation[]> {
    const page = await browser.newPage();
    try {
      await page.goto(url, { timeout: 15_000, waitUntil: 'domcontentloaded' });

      // Guard against cross-origin redirects (e.g. Shopify → shop.app strict CSP).
      // axe injection would fail or produce no useful results on a foreign origin.
      const landedOrigin = new URL(page.url()).origin;
      const targetOrigin = new URL(url).origin;
      if (landedOrigin !== targetOrigin) return [];

      await page.addScriptTag({ content: getAxeSource() });
      const result = await page.evaluate(async () => {
        // @ts-expect-error axe injected globally
        return await axe.run() as AxeResult;
      });
      return result.violations;
    } finally {
      await page.close();
    }
  }

  // Public so tests can exercise the URL-selection logic via a mock crawler.
  async resolveProductUrl(): Promise<string> {
    try {
      const r = await this.crawler.get('/products.json?limit=1');
      const data = JSON.parse(r.text) as { products?: { handle: string }[] };
      const handle = data.products?.[0]?.handle;
      if (handle) return `${this.crawler.baseUrl}/products/${handle}`;
    } catch { /* no /products.json — skip product scan */ }
    return '';
  }
}
