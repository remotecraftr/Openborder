import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { LegalPagesModule } from '../src/modules/m1Legal';
import type { Crawler } from '../src/crawler';
import type { FetchResult } from '../src/types';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

const BARE_HOME = '<html><body><footer><a href="/policies/privacy-policy">Privacy</a></footer></body></html>';
const HOME_WITH_IMPRESSUM = '<html><body><footer><a href="/pages/impressum">Impressum</a></footer></body></html>';
const HOME_WITH_VAT = '<html><body><footer><p>DE123456789 · My GmbH</p></footer></body></html>';
const PRIVACY_WITH_OPT_OUT = '<html><body><p>You may opt-out of the sale of your personal information at any time. We support Global Privacy Control (GPC).</p></body></html>';
const PRIVACY_NO_OPT_OUT = '<html><body><p>We collect your name, email address, and shipping address to process and fulfill your orders. We may share this data with trusted third-party logistics and payment partners to complete your purchase. We retain your data for up to seven years in accordance with applicable law.</p></body></html>';
const POLICY_HTML = '<html><body><p>We accept returns within 30 days of purchase for most items in new, unused condition.</p></body></html>';

function mockCrawler(responses: Record<string, Partial<FetchResult>>): Crawler {
  const baseUrl = 'https://example.com';

  async function get(pathOrUrl: string): Promise<FetchResult> {
    const key = pathOrUrl.startsWith('http') ? pathOrUrl.replace(baseUrl, '') : pathOrUrl;
    const resp = responses[key];
    if (resp === undefined) throw new Error(`Unexpected fetch: ${pathOrUrl}`);
    return { url: `${baseUrl}${key}`, status: 200, text: '', finalUrl: `${baseUrl}${key}`, ...resp };
  }

  return { baseUrl, get, requestsUsed: 0 } as unknown as Crawler;
}

describe('LegalPagesModule', () => {
  it('marks missing policy as fail (404)', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 404, text: '' },
      '/policies/privacy-policy':   { status: 404, text: '' },
      '/policies/terms-of-service': { status: 404, text: '' },
      '/policies/shipping-policy':  { status: 404, text: '' },
      '/':                          { status: 200, text: BARE_HOME },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const refund = findings.find(f => f.checkId === 'm1_refund_policy');
    expect(refund?.status).toBe('fail');
    // PRD: returns missing ≈ 82
    expect(refund?.severity).toBe(82);
  });

  it('marks present policy as pass', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 200, text: fixture('refund_with_withdrawal.html') },
      '/policies/privacy-policy':   { status: 200, text: POLICY_HTML },
      '/policies/terms-of-service': { status: 200, text: POLICY_HTML },
      '/policies/shipping-policy':  { status: 200, text: POLICY_HTML },
      '/':                          { status: 200, text: BARE_HOME },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const refund = findings.find(f => f.checkId === 'm1_refund_policy');
    expect(refund?.status).toBe('pass');
  });

  it('detects withdrawal clause via regex (no LLM)', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 200, text: fixture('refund_with_withdrawal.html') },
      '/policies/privacy-policy':   { status: 200, text: '<html><body>Privacy policy text with sufficient content here.</body></html>' },
      '/policies/terms-of-service': { status: 200, text: '<html><body>Terms of service text with sufficient content here.</body></html>' },
      '/policies/shipping-policy':  { status: 200, text: '<html><body>Shipping policy text with sufficient content here.</body></html>' },
      '/':                          { status: 200, text: BARE_HOME },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const withdrawal = findings.find(f => f.checkId === 'm1_eu_withdrawal');
    expect(withdrawal).toBeDefined();
    expect(withdrawal?.status).toBe('pass');
  });

  it('fails withdrawal clause when not present', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 200, text: fixture('refund_no_withdrawal.html') },
      '/policies/privacy-policy':   { status: 200, text: '<html><body>Privacy policy text with sufficient content here.</body></html>' },
      '/policies/terms-of-service': { status: 200, text: '<html><body>Terms of service text with sufficient content here.</body></html>' },
      '/policies/shipping-policy':  { status: 200, text: '<html><body>Shipping policy text with sufficient content here.</body></html>' },
      '/':                          { status: 200, text: BARE_HOME },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const withdrawal = findings.find(f => f.checkId === 'm1_eu_withdrawal');
    expect(withdrawal).toBeDefined();
    expect(['fail', 'warn']).toContain(withdrawal?.status);
  });

  it('marks thin page as warn (not fail)', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 200, text: '<html><body><p>Short.</p></body></html>' },
      '/policies/privacy-policy':   { status: 200, text: '<html><body><p>Short.</p></body></html>' },
      '/policies/terms-of-service': { status: 200, text: '<html><body><p>Short.</p></body></html>' },
      '/policies/shipping-policy':  { status: 200, text: '<html><body><p>Short.</p></body></html>' },
      '/':                          { status: 200, text: BARE_HOME },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const refund = findings.find(f => f.checkId === 'm1_refund_policy');
    expect(refund?.status).toBe('warn');
  });

  it('detects EU imprint via Impressum link in footer', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 200, text: POLICY_HTML },
      '/policies/privacy-policy':   { status: 200, text: POLICY_HTML },
      '/policies/terms-of-service': { status: 200, text: POLICY_HTML },
      '/policies/shipping-policy':  { status: 200, text: POLICY_HTML },
      '/':                          { status: 200, text: HOME_WITH_IMPRESSUM },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const imprint = findings.find(f => f.checkId === 'm1_eu_imprint');
    expect(imprint).toBeDefined();
    expect(imprint?.status).toBe('pass');
  });

  it('detects EU imprint via VAT number in footer', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 200, text: POLICY_HTML },
      '/policies/privacy-policy':   { status: 200, text: POLICY_HTML },
      '/policies/terms-of-service': { status: 200, text: POLICY_HTML },
      '/policies/shipping-policy':  { status: 200, text: POLICY_HTML },
      '/':                          { status: 200, text: HOME_WITH_VAT },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const imprint = findings.find(f => f.checkId === 'm1_eu_imprint');
    expect(imprint).toBeDefined();
    expect(imprint?.status).toBe('pass');
  });

  it('flags missing EU imprint as not_detected with severity 80', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 200, text: POLICY_HTML },
      '/policies/privacy-policy':   { status: 200, text: POLICY_HTML },
      '/policies/terms-of-service': { status: 200, text: POLICY_HTML },
      '/policies/shipping-policy':  { status: 200, text: POLICY_HTML },
      '/':                          { status: 200, text: BARE_HOME },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const imprint = findings.find(f => f.checkId === 'm1_eu_imprint');
    expect(imprint).toBeDefined();
    expect(imprint?.status).toBe('not_detected');
    expect(imprint?.severity).toBe(80);
  });

  it('passes US opt-out check when privacy policy contains opt-out language', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 200, text: POLICY_HTML },
      '/policies/privacy-policy':   { status: 200, text: PRIVACY_WITH_OPT_OUT },
      '/policies/terms-of-service': { status: 200, text: POLICY_HTML },
      '/policies/shipping-policy':  { status: 200, text: POLICY_HTML },
      '/':                          { status: 200, text: BARE_HOME },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const optOut = findings.find(f => f.checkId === 'm1_us_opt_out');
    expect(optOut).toBeDefined();
    expect(optOut?.status).toBe('pass');
  });

  it('warns when privacy policy lacks opt-out language', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 200, text: POLICY_HTML },
      '/policies/privacy-policy':   { status: 200, text: PRIVACY_NO_OPT_OUT },
      '/policies/terms-of-service': { status: 200, text: POLICY_HTML },
      '/policies/shipping-policy':  { status: 200, text: POLICY_HTML },
      '/':                          { status: 200, text: BARE_HOME },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const optOut = findings.find(f => f.checkId === 'm1_us_opt_out');
    expect(optOut).toBeDefined();
    expect(optOut?.status).toBe('warn');
  });

  it('skips opt-out check when privacy policy is missing', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 200, text: POLICY_HTML },
      '/policies/privacy-policy':   { status: 404, text: '' },
      '/policies/terms-of-service': { status: 200, text: POLICY_HTML },
      '/policies/shipping-policy':  { status: 200, text: POLICY_HTML },
      '/':                          { status: 200, text: BARE_HOME },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const optOut = findings.find(f => f.checkId === 'm1_us_opt_out');
    expect(optOut).toBeUndefined();
  });

  it('uses correct severity values matching PRD', async () => {
    const crawler = mockCrawler({
      '/policies/refund-policy':    { status: 404, text: '' },
      '/policies/privacy-policy':   { status: 404, text: '' },
      '/policies/terms-of-service': { status: 404, text: '' },
      '/policies/shipping-policy':  { status: 404, text: '' },
      '/':                          { status: 200, text: BARE_HOME },
    });

    const mod = new LegalPagesModule(crawler);
    const findings = await mod.run();
    const privacy = findings.find(f => f.checkId === 'm1_privacy_policy');
    const refund  = findings.find(f => f.checkId === 'm1_refund_policy');
    const terms   = findings.find(f => f.checkId === 'm1_terms_of_service');
    // PRD §5 severity guide
    expect(privacy?.severity).toBe(92);
    expect(refund?.severity).toBe(82);
    expect(terms?.severity).toBe(75);
  });
});
