import * as cheerio from 'cheerio';
import { BaseModule } from './base';
import type { Crawler } from '../crawler';
import type { Finding } from '../types';
import { launchBrowser } from '../browser';

export class LocalizationModule extends BaseModule {
  readonly moduleId = 'localization';
  private readonly usePlaywright: boolean;

  constructor(crawler: Crawler, opts: { usePlaywright?: boolean } = {}) {
    super(crawler);
    this.usePlaywright = opts.usePlaywright ?? false;
  }

  async run(): Promise<Finding[]> {
    const findings: Finding[] = [];
    let html = '';

    try {
      html = await this.fetchRenderedHtml();
    } catch (err) {
      findings.push({
        module: this.moduleId,
        checkId: 'm3_hreflang',
        title: 'hreflang Tags',
        status: 'error',
        severity: 0,
        confidence: 'low',
        evidence: { url: this.crawler.baseUrl, value: String(err) },
        suggestion: 'Could not fetch homepage for localization check.',
      });
      return findings;
    }

    const $ = cheerio.load(html);

    findings.push(this.checkHreflang($, html));
    findings.push(this.checkLocalizationForm($, html));
    findings.push(this.checkCurrencySelector($, html));
    findings.push(this.checkEnabledCurrencies($, html));

    return findings;
  }

  private async fetchRenderedHtml(): Promise<string> {
    if (!this.usePlaywright) {
      const result = await this.crawler.get('/');
      return result.text;
    }

    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.goto(this.crawler.baseUrl, { timeout: 15_000, waitUntil: 'networkidle' });
      return await page.content();
    } finally {
      await browser.close();
    }
  }

  private checkHreflang($: cheerio.CheerioAPI, _html: string): Finding {
    const tags = $('link[rel="alternate"][hreflang]').toArray();
    if (!tags.length) {
      return {
        module: this.moduleId,
        checkId: 'm3_hreflang',
        title: 'hreflang Tags',
        status: 'not_detected',
        severity: 45,
        confidence: 'high',
        evidence: { url: this.crawler.baseUrl },
        suggestion: 'No hreflang tags found. If you serve content in multiple languages or regions, add hreflang link tags to help search engines serve the correct version.',
      };
    }

    const locales = tags
      .map(el => $(el).attr('hreflang'))
      .filter(Boolean) as string[];

    const hasXDefault = locales.includes('x-default');

    return {
      module: this.moduleId,
      checkId: 'm3_hreflang',
      title: 'hreflang Tags',
      status: hasXDefault ? 'pass' : 'warn',
      severity: hasXDefault ? 0 : 30,
      confidence: 'high',
      evidence: {
        url: this.crawler.baseUrl,
        value: locales.join(', '),
        snippet: hasXDefault ? undefined : 'x-default tag missing',
      },
      suggestion: hasXDefault
        ? ''
        : 'hreflang tags present but no x-default entry. Add <link rel="alternate" hreflang="x-default" href="..."> to specify the fallback URL.',
    };
  }

  private checkLocalizationForm($: cheerio.CheerioAPI, html: string): Finding {
    const form = $('form').toArray().find(el => {
      const action = $(el).attr('action') ?? '';
      const inner = $(el).html() ?? '';
      return (
        action.includes('localization') ||
        inner.includes('country_code') ||
        /disclosure/i.test(inner)
      );
    });

    const hasLocaleSelect =
      $('select[name*="locale"], select[name*="country"], select[id*="locale"]').length > 0;

    if (form || hasLocaleSelect) {
      return {
        module: this.moduleId,
        checkId: 'm3_localization_form',
        title: 'Shopify Localization Form / Country Selector',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl },
        suggestion: '',
      };
    }

    return {
      module: this.moduleId,
      checkId: 'm3_localization_form',
      title: 'Shopify Localization Form / Country Selector',
      status: 'not_detected',
      severity: 40,
      confidence: 'medium',
      evidence: { url: this.crawler.baseUrl },
      suggestion: 'No country/locale selector found in page source. If your theme renders it via JavaScript, the static scanner may miss it. Verify customers can switch market or language on your storefront.',
    };
  }

  private checkCurrencySelector($: cheerio.CheerioAPI, html: string): Finding {
    const currencySelectors = [
      $('[data-currency-selector]').length > 0,
      $('[id*="currency-selector"], [id*="currency_selector"]').length > 0,
      /currency[-_]?switch|currency[-_]?select/i.test(html),
      /presentmentCurrencies/i.test(html),
    ];

    const hasSelector = currencySelectors.some(Boolean);

    if (hasSelector) {
      return {
        module: this.moduleId,
        checkId: 'm3_currency_selector',
        title: 'Currency Selector',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl },
        suggestion: '',
      };
    }

    return {
      module: this.moduleId,
      checkId: 'm3_currency_selector',
      title: 'Currency Selector',
      status: 'not_detected',
      severity: 35,
      confidence: 'low',
      evidence: { url: this.crawler.baseUrl, value: 'Not found in page source — may be JavaScript-rendered' },
      suggestion: 'No currency selector found in page source. If your theme renders it via JavaScript, the static scanner may miss it. Verify customers can switch currency on your storefront.',
    };
  }

  private checkEnabledCurrencies(_$: cheerio.CheerioAPI, html: string): Finding {
    const activeMatch = html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/);
    const presentmentMatch = html.match(/presentmentCurrencies\s*[=:]\s*(\[[^\]]+\])/);
    const multiCurrencyMatch = html.match(/"currencies"\s*:\s*\[([^\]]+)\]/);

    let currencies: string[] = [];

    if (presentmentMatch) {
      try {
        currencies = JSON.parse(presentmentMatch[1]).filter((c: unknown) => typeof c === 'string');
      } catch { /* ignore */ }
    } else if (multiCurrencyMatch) {
      currencies = multiCurrencyMatch[1]
        .match(/"([A-Z]{3})"/g)
        ?.map(m => m.replace(/"/g, '')) ?? [];
    }

    if (currencies.length > 1) {
      return {
        module: this.moduleId,
        checkId: 'm3_enabled_currencies',
        title: 'Multi-Currency Support',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl, value: currencies.join(', ') },
        suggestion: '',
      };
    }

    if (activeMatch) {
      const currency = activeMatch[1];
      return {
        module: this.moduleId,
        checkId: 'm3_enabled_currencies',
        title: 'Multi-Currency Support',
        status: currency === 'USD' ? 'warn' : 'pass',
        severity: currency === 'USD' ? 25 : 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl, value: `Active currency: ${currency}` },
        suggestion: currency === 'USD'
          ? 'Only USD detected. Enable additional currencies in Shopify Markets to let international shoppers checkout in their local currency.'
          : '',
      };
    }

    return {
      module: this.moduleId,
      checkId: 'm3_enabled_currencies',
      title: 'Multi-Currency Support',
      status: 'not_detected',
      severity: 30,
      confidence: 'low',
      evidence: { url: this.crawler.baseUrl },
      suggestion: 'Could not detect currency configuration in page source. Verify Shopify Markets is enabled and currencies are published.',
    };
  }
}
