import * as fs from 'fs';
import * as path from 'path';
import { ConsentTrackingModule } from '../src/modules/m2Consent';
import type { Crawler } from '../src/crawler';
import type { FetchResult } from '../src/types';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function mockCrawler(html: string, url = 'https://example.com'): Crawler {
  async function get(_path: string): Promise<FetchResult> {
    return { url, status: 200, text: html, finalUrl: url };
  }
  return { baseUrl: url, get, requestsUsed: 0 } as unknown as Crawler;
}

describe('ConsentTrackingModule', () => {
  it('detects Cookiebot as CMP pass', async () => {
    const html = fixture('homepage_shopify.html');
    const mod = new ConsentTrackingModule(mockCrawler(html));
    const findings = await mod.run();
    const cmp = findings.find(f => f.checkId === 'm2_cmp_present');
    expect(cmp?.status).toBe('pass');
    expect(cmp?.evidence.value).toBe('Cookiebot');
  });

  it('flags trackers without CMP as fail', async () => {
    const html = `<!DOCTYPE html><html><head>
      <script src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"></script>
      <script>fbq('init', '123456');</script>
    </head><body></body></html>`;
    const mod = new ConsentTrackingModule(mockCrawler(html));
    const findings = await mod.run();
    const trackers = findings.filter(
      f => f.checkId.startsWith('m2_tracker_') && f.status === 'fail'
    );
    expect(trackers.length).toBeGreaterThan(0);
  });

  it('detects CCPA opt-out link', async () => {
    const html = fixture('homepage_shopify.html');
    const mod = new ConsentTrackingModule(mockCrawler(html));
    const findings = await mod.run();
    const ccpa = findings.find(f => f.checkId === 'm2_ccpa_opt_out');
    expect(ccpa?.status).toBe('pass');
  });

  it('marks CCPA as not_detected when absent', async () => {
    const html = fixture('homepage_bare.html');
    const mod = new ConsentTrackingModule(mockCrawler(html));
    const findings = await mod.run();
    const ccpa = findings.find(f => f.checkId === 'm2_ccpa_opt_out');
    expect(ccpa?.status).toBe('not_detected');
  });

  it('detects privacy policy link', async () => {
    const html = fixture('homepage_shopify.html');
    const mod = new ConsentTrackingModule(mockCrawler(html));
    const findings = await mod.run();
    const link = findings.find(f => f.checkId === 'm2_privacy_link');
    expect(link?.status).toBe('pass');
  });

  it('not_detected privacy link on bare page', async () => {
    const html = fixture('homepage_bare.html');
    const mod = new ConsentTrackingModule(mockCrawler(html));
    const findings = await mod.run();
    const link = findings.find(f => f.checkId === 'm2_privacy_link');
    expect(link?.status).toBe('not_detected');
  });
});
