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
      // Playwright failed — fall back to static HTML so all checks still run.
      // This is better than aborting all M3 findings.
      console.warn(`[m3] Playwright render failed, falling back to static HTML: ${String(err)}`);
      try {
        const result = await this.crawler.get('/');
        html = result.text;
      } catch (staticErr) {
        // Both Playwright and static fetch failed — nothing we can do
        findings.push({
          module: this.moduleId,
          checkId: 'm3_hreflang',
          title: 'hreflang Tags',
          status: 'error',
          severity: 0,
          confidence: 'low',
          evidence: { url: this.crawler.baseUrl, value: String(staticErr) },
          suggestion: 'Could not fetch homepage for localization check.',
        });
        return findings;
      }
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

      // Shopify themes often lazy-load footer content (where currency/country
      // selectors live). Scroll to bottom to trigger lazy-load, then wait for
      // custom elements like <localization-form> to fully hydrate.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);

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

    const hasDynamicSelector = 
      $('.language-selector, .country-selector, [data-target-section-id*="currency-switcher"], [data-target-section-id*="country-switcher"]').length > 0;

    if (form || hasLocaleSelect || hasDynamicSelector) {
      const signal = form ? 'Localization form found in page source' : 'Locale/country select element found in page source';
      return {
        module: this.moduleId,
        checkId: 'm3_localization_form',
        title: 'Shopify Localization Form / Country Selector',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl, value: signal },
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
    // Comprehensive Shopify currency selector detection
    // Shopify themes use various patterns: localization forms, disclosure widgets,
    // custom elements, and JS-based selectors. We check them all.
    const signals: Array<{ label: string; match: boolean }> = [
      // Direct currency selector attributes
      { label: 'data-currency-selector attribute', match: $('[data-currency-selector]').length > 0 },
      { label: 'data-currency attribute', match: $('[data-currency]').length > 0 },

      // CSS class/id containing "currency"
      { label: 'currency-related element (class/id)', match: $('[class*="currency"], [id*="currency"]').length > 0 },

      // Data attributes containing "currency"
      { label: 'currency-related data attribute', match: $('[data-target*="currency"], [data-target-section-id*="currency"], [data-target-script-url*="currency"]').length > 0 },

      // Form input with name="currency_code" (Shopify localization form standard)
      { label: 'currency_code form input', match: $('input[name="currency_code"], select[name="currency_code"]').length > 0 },

      // Shopify localization-form custom element containing currency signals
      { label: 'localization-form with currency', match:
        $('localization-form').length > 0 &&
        ($('localization-form').html() ?? '').toLowerCase().includes('currency')
      },

      // Disclosure widget for currency (Shopify Dawn theme pattern)
      { label: 'disclosure-currency element', match:
        $('[data-disclosure-currency], [id*="disclosure-currency"], [class*="disclosure-currency"]').length > 0
      },

      // Any element with name attribute containing "currency"
      { label: 'currency-named element', match: $('[name*="currency"]').length > 0 },

      // Select elements with currency options (currency codes like USD, EUR, GBP)
      { label: 'select with currency options', match:
        $('select').toArray().some(el => {
          const inner = $(el).html() ?? '';
          return /\b(AED|AFN|ALL|AMD|ANG|AOA|ARS|AUD|AWG|AZN|BAM|BBD|BDT|BGN|BHD|BIF|BMD|BND|BOB|BOV|BRL|BSD|BTN|BWP|BYN|BZD|CAD|CDF|CHE|CHF|CHW|CLF|CLP|CNY|COP|COU|CRC|CUC|CUP|CVE|CZK|DJF|DKK|DOP|DZD|EGP|ERN|ETB|EUR|FJD|FKP|GBP|GEL|GHS|GIP|GMD|GNF|GTQ|GYD|HKD|HNL|HRK|HTG|HUF|IDR|ILS|INR|IQD|IRR|ISK|JMD|JOD|JPY|KES|KGS|KHR|KMF|KPW|KRW|KWD|KYD|KZT|LAK|LBP|LKR|LRD|LSL|LYD|MAD|MDL|MGA|MKD|MMK|MNT|MOP|MRU|MUR|MVR|MWK|MXN|MXV|MYR|MZN|NAD|NGN|NIO|NOK|NPR|NZD|OMR|PAB|PEN|PGK|PHP|PKR|PLN|PYG|QAR|RON|RSD|RUB|RWF|SAR|SBD|SCR|SDG|SEK|SGD|SHP|SLL|SOS|SRD|SSP|STN|SVC|SYP|SZL|THB|TJS|TMT|TND|TOP|TRY|TTD|TWD|TZS|UAH|UGX|USD|USN|UYI|UYU|UYW|UZS|VEF|VES|VND|VUV|WST|XAF|XAG|XAU|XBA|XBB|XBC|XBD|XCD|XDR|XOF|XPD|XPF|XPT|XSU|XTS|XUA|XXX|YER|ZAR|ZMW|ZWL)\b/.test(inner);
        })
      },

      // Form with action="/localization" containing currency_code
      { label: 'localization form with currency_code', match:
        $('form[action*="localization"]').toArray().some(el => {
          const inner = $(el).html() ?? '';
          return inner.includes('currency_code') || inner.includes('currency');
        })
      },

      // JS patterns
      { label: 'currency-switch/select JS pattern', match: /currency[-_]?switch|currency[-_]?select|currency[-_]?picker|currency[-_]?dropdown/i.test(html) },
      { label: 'Shopify.currency JS object', match: /Shopify\.currency/i.test(html) },
      { label: 'presentmentCurrencies API', match: /presentmentCurrencies/i.test(html) },

      // Currency symbols alongside currency code patterns (€, £, ¥, $ with codes)
      { label: 'currency code + symbol in selector', match:
        $('[class*="disclosure"], [class*="selector"], [class*="picker"], [class*="dropdown"]').toArray().some(el => {
          const text = $(el).text();
          return /\b(USD|EUR|GBP|CAD|AUD)\b/.test(text) && /[$€£¥]/.test(text);
        })
      },
    ];

    const matched = signals.filter(s => s.match);

    // Debug logging — helps diagnose detection issues in server logs
    console.log(`[m3] Currency selector detection for ${this.crawler.baseUrl}:`);
    for (const s of signals) {
      console.log(`[m3]   ${s.match ? '✓' : '✗'} ${s.label}`);
    }

    if (matched.length > 0) {
      const matchedLabels = matched.map(s => s.label).join(', ');
      return {
        module: this.moduleId,
        checkId: 'm3_currency_selector',
        title: 'Currency Selector',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl, value: `Detected via: ${matchedLabels}` },
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
      evidence: { url: this.crawler.baseUrl, value: 'No currency selector found in rendered page (checked via Playwright)' },
      suggestion: 'No currency selector detected in the fully-rendered page. Verify customers can switch currency on your storefront.',
    };
  }

  private checkEnabledCurrencies($: cheerio.CheerioAPI, html: string): Finding {
    const activeMatch = html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/);
    const presentmentMatch = html.match(/presentmentCurrencies\s*[=:]\s*(\[[^\]]+\])/);
    const multiCurrencyMatch = html.match(/"currencies"\s*:\s*\[([^\]]+)\]/);

    let currencies: string[] = [];

    // Method 1: presentmentCurrencies JS array
    if (presentmentMatch) {
      try {
        currencies = JSON.parse(presentmentMatch[1]).filter((c: unknown) => typeof c === 'string');
      } catch { /* ignore */ }
    }

    // Method 2: "currencies": [...] JSON
    if (currencies.length <= 1 && multiCurrencyMatch) {
      currencies = multiCurrencyMatch[1]
        .match(/"([A-Z]{3})"/g)
        ?.map(m => m.replace(/"/g, '')) ?? [];
    }

    // Method 3: Scan DOM for currency codes inside selectors, forms, and disclosure elements
    // This catches JS-rendered currency selectors that have multiple currency options
    if (currencies.length <= 1) {
      const CURRENCY_CODES = /\b(AED|AFN|ALL|AMD|ANG|AOA|ARS|AUD|AWG|AZN|BAM|BBD|BDT|BGN|BHD|BIF|BMD|BND|BOB|BOV|BRL|BSD|BTN|BWP|BYN|BZD|CAD|CDF|CHE|CHF|CHW|CLF|CLP|CNY|COP|COU|CRC|CUC|CUP|CVE|CZK|DJF|DKK|DOP|DZD|EGP|ERN|ETB|EUR|FJD|FKP|GBP|GEL|GHS|GIP|GMD|GNF|GTQ|GYD|HKD|HNL|HRK|HTG|HUF|IDR|ILS|INR|IQD|IRR|ISK|JMD|JOD|JPY|KES|KGS|KHR|KMF|KPW|KRW|KWD|KYD|KZT|LAK|LBP|LKR|LRD|LSL|LYD|MAD|MDL|MGA|MKD|MMK|MNT|MOP|MRU|MUR|MVR|MWK|MXN|MXV|MYR|MZN|NAD|NGN|NIO|NOK|NPR|NZD|OMR|PAB|PEN|PGK|PHP|PKR|PLN|PYG|QAR|RON|RSD|RUB|RWF|SAR|SBD|SCR|SDG|SEK|SGD|SHP|SLL|SOS|SRD|SSP|STN|SVC|SYP|SZL|THB|TJS|TMT|TND|TOP|TRY|TTD|TWD|TZS|UAH|UGX|USD|USN|UYI|UYU|UYW|UZS|VEF|VES|VND|VUV|WST|XAF|XAG|XAU|XBA|XBB|XBC|XBD|XCD|XDR|XOF|XPD|XPF|XPT|XSU|XTS|XUA|XXX|YER|ZAR|ZMW|ZWL)\b/g;
      const domCurrencies = new Set<string>();
      if (activeMatch) {
        domCurrencies.add(activeMatch[1]);
      }

      // Check select options, disclosure lists, localization forms, and currency-related elements
      const selectors = [
        'select option',
        '[class*="disclosure"] li, [class*="disclosure"] a, [class*="disclosure"] button',
        'localization-form option, localization-form li, localization-form a',
        'form[action*="localization"] option, form[action*="localization"] li',
        '[class*="currency"] option, [class*="currency"] li, [class*="currency"] a',
        '[data-currency-selector] option, [data-currency-selector] li',
        '[name="currency_code"] option',
        '.country-iso-code',
      ];

      for (const sel of selectors) {
        $(sel).each((_i, el) => {
          const text = $(el).text();
          const value = $(el).attr('value') ?? '';
          const dataValue = $(el).attr('data-value') ?? '';
          const combined = `${text} ${value} ${dataValue}`;
          const matches = combined.match(CURRENCY_CODES);
          if (matches) matches.forEach(c => domCurrencies.add(c));
        });
      }

      if (domCurrencies.size > 1) {
        currencies = [...domCurrencies];
      }
    }

    // Method 4: If we detected a dynamic currency modal script, assume it supports multi-currency
    if (currencies.length <= 1) {
      if ($('[data-target-script-url*="currency"], [data-target-section-id*="currency-switcher"]').length > 0) {
        return {
          module: this.moduleId,
          checkId: 'm3_enabled_currencies',
          title: 'Multi-Currency Support',
          status: 'pass',
          severity: 0,
          confidence: 'medium',
          evidence: { url: this.crawler.baseUrl, value: `Dynamic currency switcher detected (JS modal)` },
          suggestion: '',
        };
      }
    }

    if (currencies.length > 1) {
      return {
        module: this.moduleId,
        checkId: 'm3_enabled_currencies',
        title: 'Multi-Currency Support',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl, value: `${currencies.length} currencies enabled: ${currencies.join(', ')}` },
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
