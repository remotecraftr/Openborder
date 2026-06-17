import * as fs from 'fs';
import * as path from 'path';
import { LocalizationModule } from '../src/modules/m3Locale';
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

describe('LocalizationModule', () => {
  it('detects hreflang tags with x-default as pass', async () => {
    const html = fixture('homepage_shopify.html');
    const mod = new LocalizationModule(mockCrawler(html));
    const findings = await mod.run();
    const hreflang = findings.find(f => f.checkId === 'm3_hreflang');
    expect(hreflang?.status).toBe('pass');
  });

  it('marks hreflang as not_detected on bare page', async () => {
    const html = fixture('homepage_bare.html');
    const mod = new LocalizationModule(mockCrawler(html));
    const findings = await mod.run();
    const hreflang = findings.find(f => f.checkId === 'm3_hreflang');
    expect(hreflang?.status).toBe('not_detected');
  });

  it('detects localization form', async () => {
    const html = fixture('homepage_shopify.html');
    const mod = new LocalizationModule(mockCrawler(html));
    const findings = await mod.run();
    const form = findings.find(f => f.checkId === 'm3_localization_form');
    expect(form?.status).toBe('pass');
  });

  it('detects multi-currency from presentmentCurrencies', async () => {
    const html = fixture('homepage_shopify.html');
    const mod = new LocalizationModule(mockCrawler(html));
    const findings = await mod.run();
    const currencies = findings.find(f => f.checkId === 'm3_enabled_currencies');
    expect(currencies?.status).toBe('pass');
  });

  it('warns when only single USD currency detected', async () => {
    const html = `<html><head></head><body><script>
      Shopify.currency = {"active":"USD","rate":"1.0"};
    </script></body></html>`;
    const mod = new LocalizationModule(mockCrawler(html));
    const findings = await mod.run();
    const currencies = findings.find(f => f.checkId === 'm3_enabled_currencies');
    expect(currencies?.status).toBe('warn');
  });
});
