import { buildAxeFinding, AccessibilityModule } from '../src/modules/m4Axe';
import type { AxeViolation } from '../src/modules/m4Axe';
import type { Crawler } from '../src/crawler';
import type { FetchResult } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function violation(
  id: string,
  impact: AxeViolation['impact'],
  description = `${id} description`,
): AxeViolation {
  return { id, impact, description, nodes: [{ html: `<div id="${id}">`, target: [`#${id}`] }] };
}

function mockCrawler(
  responses: Record<string, Partial<FetchResult>>,
  baseUrl = 'https://example.com',
): Crawler {
  async function get(pathOrUrl: string): Promise<FetchResult> {
    const key = pathOrUrl.startsWith('http') ? pathOrUrl.replace(baseUrl, '') : pathOrUrl;
    const resp = responses[key];
    if (!resp) throw new Error(`Unexpected fetch: ${pathOrUrl}`);
    return { url: `${baseUrl}${key}`, status: 200, text: '', finalUrl: `${baseUrl}${key}`, ...resp };
  }
  return { baseUrl, get, requestsUsed: 0 } as unknown as Crawler;
}

// ---------------------------------------------------------------------------
// buildAxeFinding — pure function tests
// ---------------------------------------------------------------------------

describe('buildAxeFinding', () => {
  it('returns pass when no violations', () => {
    const f = buildAxeFinding([], 'https://example.com/', 'm4_axe_homepage', 'Homepage');
    expect(f.status).toBe('pass');
    expect(f.severity).toBe(0);
    expect(f.suggestion).toBe('');
  });

  it('fails with sev 78 and correct evidence for 3 critical + 11 moderate (PRD example)', () => {
    const violations = [
      violation('color-contrast', 'critical'),
      violation('label', 'critical'),
      violation('image-alt', 'critical'),
      ...Array.from({ length: 11 }, (_, i) => violation(`moderate-${i}`, 'moderate')),
    ];
    const f = buildAxeFinding(violations, 'https://example.com/', 'm4_axe_homepage', 'Homepage');
    expect(f.status).toBe('fail');
    expect(f.severity).toBe(78);
    expect(f.evidence.value).toBe('14 violations: 3 critical, 11 moderate');
    expect(f.suggestion).toMatch(/axe found 3 serious issues/);
    expect(f.suggestion).toMatch(/color-contrast/);
    expect(f.suggestion).toMatch(/Remediate in code — do not use an accessibility overlay widget/);
  });

  it('fails with sev 65 when only serious violations', () => {
    const violations = [violation('aria-required-attr', 'serious')];
    const f = buildAxeFinding(violations, 'https://example.com/products/tee', 'm4_axe_product', 'Product Page');
    expect(f.status).toBe('fail');
    expect(f.severity).toBe(65);
    expect(f.suggestion).toMatch(/axe found 1 serious issues/);
    expect(f.suggestion).toMatch(/Product Page/);
  });

  it('warns with sev 40 when only moderate violations', () => {
    const violations = [
      violation('link-name', 'moderate'),
      violation('region', 'moderate'),
    ];
    const f = buildAxeFinding(violations, 'https://example.com/products/tee', 'm4_axe_product', 'Product Page');
    expect(f.status).toBe('warn');
    expect(f.severity).toBe(40);
    expect(f.evidence.value).toBe('2 violations: 2 moderate');
  });

  it('warns with sev 20 when only minor violations (PRD product-page example)', () => {
    const violations = [violation('duplicate-id', 'minor')];
    const f = buildAxeFinding(violations, 'https://example.com/products/tee', 'm4_axe_product', 'Product Page');
    expect(f.status).toBe('warn');
    expect(f.severity).toBe(20);
    expect(f.evidence.value).toBe('1 violations: 1 minor');
  });

  it('includes correct checkId and module', () => {
    const f = buildAxeFinding([], 'https://example.com/', 'm4_axe_homepage', 'Homepage');
    expect(f.checkId).toBe('m4_axe_homepage');
    expect(f.module).toBe('accessibility');
  });

  it('sets tools array', () => {
    const f = buildAxeFinding([], 'https://example.com/', 'm4_axe_homepage', 'Homepage');
    expect(f.tools).toContain('axe-core@4.9.0');
    expect(f.tools).toContain('playwright');
  });

  it('includes all breakdown parts in evidence value', () => {
    const violations = [
      violation('v1', 'critical'),
      violation('v2', 'serious'),
      violation('v3', 'moderate'),
      violation('v4', 'minor'),
    ];
    const f = buildAxeFinding(violations, 'https://example.com/', 'm4_axe_homepage', 'Homepage');
    expect(f.evidence.value).toBe('4 violations: 1 critical, 1 serious, 1 moderate, 1 minor');
  });

  it('suggestion falls back to any top IDs when no critical/serious', () => {
    const violations = [violation('link-name', 'moderate'), violation('region', 'moderate')];
    const f = buildAxeFinding(violations, 'https://example.com/', 'm4_axe_homepage', 'Homepage');
    expect(f.suggestion).toMatch(/link-name/);
  });
});

// ---------------------------------------------------------------------------
// AccessibilityModule.resolveProductUrl
// ---------------------------------------------------------------------------

describe('AccessibilityModule.resolveProductUrl', () => {
  it('returns product URL from /products.json first handle', async () => {
    const products = JSON.stringify({ products: [{ handle: 'blue-shirt' }, { handle: 'red-pants' }] });
    const crawler = mockCrawler({ '/products.json?limit=1': { text: products } });
    const mod = new AccessibilityModule(crawler);
    expect(await mod.resolveProductUrl()).toBe('https://example.com/products/blue-shirt');
  });

  it('returns empty string when /products.json has no products', async () => {
    const crawler = mockCrawler({ '/products.json?limit=1': { text: JSON.stringify({ products: [] }) } });
    const mod = new AccessibilityModule(crawler);
    expect(await mod.resolveProductUrl()).toBe('');
  });

  it('returns empty string when /products.json fetch throws', async () => {
    const crawler = mockCrawler({});
    const mod = new AccessibilityModule(crawler);
    expect(await mod.resolveProductUrl()).toBe('');
  });

  it('returns empty string when JSON is malformed', async () => {
    const crawler = mockCrawler({ '/products.json?limit=1': { text: 'not-json' } });
    const mod = new AccessibilityModule(crawler);
    expect(await mod.resolveProductUrl()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// AccessibilityModule.run — integration with mocked browser
// ---------------------------------------------------------------------------

jest.mock('../src/browser', () => ({ launchBrowser: jest.fn() }));
import { launchBrowser } from '../src/browser';
const mockLaunch = launchBrowser as jest.Mock;

function makeMockBrowser(pages: {
  url: string;
  violations: AxeViolation[];
}[]): object {
  let callIndex = -1;
  return {
    newPage: jest.fn(() => {
      callIndex++;
      const { url, violations } = pages[callIndex] ?? { url: 'https://example.com/', violations: [] };
      return {
        goto: jest.fn().mockResolvedValue(undefined),
        url: jest.fn().mockReturnValue(url),
        addScriptTag: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue({ violations }),
        close: jest.fn().mockResolvedValue(undefined),
      };
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AccessibilityModule.run (mocked browser)', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns homepage + product findings', async () => {
    const homeViolations   = [violation('color-contrast', 'critical')];
    const productViolations = [violation('duplicate-id', 'minor')];

    mockLaunch.mockResolvedValue(makeMockBrowser([
      { url: 'https://example.com/', violations: homeViolations },
      { url: 'https://example.com/products/tee', violations: productViolations },
    ]));

    const products = JSON.stringify({ products: [{ handle: 'tee' }] });
    const crawler  = mockCrawler({ '/products.json?limit=1': { text: products } });
    const mod      = new AccessibilityModule(crawler);

    const findings = await mod.run();
    expect(findings).toHaveLength(2);

    const home = findings.find(f => f.checkId === 'm4_axe_homepage');
    expect(home?.status).toBe('fail');
    expect(home?.severity).toBe(78);

    const product = findings.find(f => f.checkId === 'm4_axe_product');
    expect(product?.status).toBe('warn');
    expect(product?.severity).toBe(20);
  });

  it('returns only homepage finding when no product URL', async () => {
    const homeViolations = [violation('image-alt', 'serious')];
    mockLaunch.mockResolvedValue(makeMockBrowser([
      { url: 'https://example.com/', violations: homeViolations },
    ]));

    const crawler = mockCrawler({ '/products.json?limit=1': { text: JSON.stringify({ products: [] }) } });
    const mod     = new AccessibilityModule(crawler);
    const findings = await mod.run();

    expect(findings).toHaveLength(1);
    expect(findings[0].checkId).toBe('m4_axe_homepage');
    expect(findings[0].status).toBe('fail');
  });

  it('returns pass finding when homepage has no violations', async () => {
    mockLaunch.mockResolvedValue(makeMockBrowser([
      { url: 'https://example.com/', violations: [] },
    ]));

    const crawler = mockCrawler({ '/products.json?limit=1': { text: JSON.stringify({ products: [] }) } });
    const mod     = new AccessibilityModule(crawler);
    const findings = await mod.run();

    expect(findings[0].status).toBe('pass');
  });

  it('returns empty violations for product page when it redirects cross-origin', async () => {
    const homeViolations = [violation('label', 'critical')];
    mockLaunch.mockResolvedValue(makeMockBrowser([
      { url: 'https://example.com/', violations: homeViolations },
      { url: 'https://shop.app/pay/something', violations: [] }, // cross-origin redirect
    ]));

    const products = JSON.stringify({ products: [{ handle: 'widget' }] });
    const crawler  = mockCrawler({ '/products.json?limit=1': { text: products } });
    const mod      = new AccessibilityModule(crawler);
    const findings = await mod.run();

    const product = findings.find(f => f.checkId === 'm4_axe_product');
    // cross-origin page returns [] violations → pass
    expect(product?.status).toBe('pass');
  });

  it('catches Playwright errors and returns SKIP finding', async () => {
    mockLaunch.mockRejectedValue(new Error('Browser launch failed'));
    const crawler = mockCrawler({ '/products.json?limit=1': { text: JSON.stringify({ products: [] }) } });
    const mod     = new AccessibilityModule(crawler);
    const findings = await mod.run();

    expect(findings).toHaveLength(1);
    expect(findings[0].checkId).toBe('m4_axe_unavailable');
    expect(findings[0].status).toBe('error');
    expect(findings[0].evidence.value).toMatch(/Browser launch failed/);
  });
});
