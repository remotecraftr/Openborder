import * as fs from 'fs';
import * as path from 'path';
import { BaseModule } from './base';
import type { Finding } from '../types';
import { launchBrowser } from '../browser';

// Lazily loaded inside runAxe() so a path error becomes a caught SKIP_FINDING, not an import crash.
// Uses process.cwd() instead of require.resolve() — webpack transforms require.resolve() into
// an internal module ID, breaking fs.readFileSync at runtime in the Next.js server bundle.
let _axeSource: string | null = null;
function getAxeSource(): string {
  if (_axeSource) return _axeSource;
  _axeSource = fs.readFileSync(
    path.join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'),
    'utf8',
  );
  return _axeSource;
}

interface AxeViolation {
  id: string;
  description: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  nodes: { html: string; target: string[] }[];
}

const IMPACT_SEVERITY: Record<string, number> = {
  critical: 85,
  serious: 65,
  moderate: 40,
  minor: 20,
};

const SKIP_FINDING = (reason: string, suggestion: string): Finding[] => [
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

export class AccessibilityModule extends BaseModule {
  readonly moduleId = 'accessibility';

  async run(): Promise<Finding[]> {
    try {
      return await this.runAxe();
    } catch (err) {
      return SKIP_FINDING(
        `Playwright failed: ${String(err)}`,
        'Accessibility scan could not complete.'
      );
    }
  }

  private async runAxe(): Promise<Finding[]> {
    const targetUrl = await this.getProductUrl();
    const browser = await launchBrowser();

    try {
      const page = await browser.newPage();
      await page.goto(targetUrl, { timeout: 15_000, waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ content: getAxeSource() });

      const results = await page.evaluate(async () => {
        // @ts-expect-error axe injected globally
        return await axe.run();
      }) as { violations: AxeViolation[] };

      const allFindings = this.violationsToFindings(results.violations, targetUrl);

      // Stretch: scan a second product page if available and different from first
      const secondUrl = await this.getProductUrl(1);
      if (secondUrl && secondUrl !== targetUrl) {
        const page2 = await browser.newPage();
        try {
          await page2.goto(secondUrl, { timeout: 15_000, waitUntil: 'domcontentloaded' });
          await page2.addScriptTag({ content: getAxeSource() });
          const results2 = await page2.evaluate(async () => {
            // @ts-expect-error axe injected globally
            return await axe.run();
          }) as { violations: AxeViolation[] };
          const p2Findings = this.violationsToFindings(results2.violations, secondUrl);
          const existingIds = new Set(allFindings.map(f => f.checkId));
          for (const f of p2Findings) {
            if (!existingIds.has(f.checkId)) allFindings.push(f);
          }
        } catch { /* second page scan is best-effort */ } finally {
          await page2.close();
        }
      }

      return allFindings;
    } finally {
      await browser.close();
    }
  }

  private async getProductUrl(index = 0): Promise<string> {
    try {
      const r = await this.crawler.get(`/products.json?limit=${index + 1}`);
      const data = JSON.parse(r.text) as { products?: { handle: string }[] };
      const handle = data.products?.[index]?.handle;
      if (handle) return `${this.crawler.baseUrl}/products/${handle}`;
    } catch { /* fallback */ }
    return index === 0 ? this.crawler.baseUrl : '';
  }

  private violationsToFindings(violations: AxeViolation[], url: string): Finding[] {
    if (!violations.length) {
      return [
        {
          module: this.moduleId,
          checkId: 'm4_axe_pass',
          title: 'Accessibility (axe-core)',
          status: 'pass',
          severity: 0,
          confidence: 'high',
          evidence: { url },
          suggestion: '',
          tools: ['axe-core@4.9.0', 'playwright'],
        },
      ];
    }

    return violations.map(v => ({
      module: this.moduleId,
      checkId: `m4_axe_${v.id}`,
      title: `Accessibility: ${v.description}`,
      status: 'fail' as const,
      severity: IMPACT_SEVERITY[v.impact ?? 'minor'] ?? 20,
      confidence: 'high' as const,
      evidence: {
        url,
        selector: v.nodes[0]?.target?.join(' ') ?? undefined,
        snippet: v.nodes[0]?.html?.slice(0, 200) ?? undefined,
      },
      suggestion: `Fix axe-core violation "${v.id}" (${v.impact ?? 'minor'} impact): ${v.description}. Affects ${v.nodes.length} element(s).`,
      tools: ['axe-core@4.9.0', 'playwright'],
    }));
  }
}
