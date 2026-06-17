import * as cheerio from 'cheerio';
import { BaseModule } from './base';
import type { Finding } from '../types';

/**
 * M5 — Tax Display Signal (stretch module)
 *
 * Static signals only — no geo-spoofing, no checkout visit.
 * Checks: VAT number in footer, "incl. VAT" price display,
 * VATMOSS / OSS mentions, EU VAT registration.
 */
export class TaxDisplayModule extends BaseModule {
  readonly moduleId = 'tax_display';

  async run(): Promise<Finding[]> {
    const findings: Finding[] = [];
    let html = '';

    try {
      const result = await this.crawler.get('/');
      html = result.text;
    } catch (err) {
      return [
        {
          module: this.moduleId,
          checkId: 'm5_tax_error',
          title: 'Tax Display Signals',
          status: 'error',
          severity: 0,
          confidence: 'low',
          evidence: { url: this.crawler.baseUrl, value: String(err) },
          suggestion: 'Could not fetch homepage to check for tax display signals.',
        },
      ];
    }

    findings.push(this.checkVatNumber(html));
    findings.push(this.checkTaxInclusivePricing(html));
    findings.push(this.checkOssVatmoss(html));

    return findings;
  }

  private checkVatNumber(html: string): Finding {
    const vatPatterns = [
      /vat\s*(?:no|number|reg(?:istration)?)?[.:\s]*[A-Z]{2}\d{8,12}/i,
      /\b[A-Z]{2}\s*\d{9,12}\b/,       // EU VAT format e.g. GB123456789
      /tax\s*(?:id|number)[.:\s]*\S+/i,
      /umsatzsteuer[\s-]?id/i,           // German VAT ID label
      /btw[\s-]?nummer/i,                // Dutch VAT
      /siret|siren\b/i,                  // French company registration
    ];

    const $ = cheerio.load(html);
    const footerText = $('footer').text() + $('[class*="footer"]').text();
    const found = vatPatterns.some(p => p.test(footerText) || p.test(html));

    if (found) {
      return {
        module: this.moduleId,
        checkId: 'm5_vat_number',
        title: 'VAT / Tax Registration Number',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl },
        suggestion: '',
      };
    }

    return {
      module: this.moduleId,
      checkId: 'm5_vat_number',
      title: 'VAT / Tax Registration Number',
      status: 'not_detected',
      severity: 30,
      confidence: 'low',
      evidence: { url: this.crawler.baseUrl },
      suggestion: 'No VAT/tax registration number found in the footer. EU/UK regulations require displaying your VAT number if you are VAT-registered and selling B2C or B2B to those regions.',
    };
  }

  private checkTaxInclusivePricing(html: string): Finding {
    const patterns = [
      /incl\.?\s*(?:vat|tax|gst|mwst)/i,
      /excl\.?\s*(?:vat|tax|gst)/i,
      /\bvat\s+included\b/i,
      /prices?\s+(?:include|including)\s+(?:vat|tax)/i,
      /tax\s+(?:included|inclusive)/i,
      /\+\s*vat\b/i,
    ];

    const found = patterns.some(p => p.test(html));
    if (found) {
      return {
        module: this.moduleId,
        checkId: 'm5_tax_inclusive_display',
        title: 'Tax-Inclusive Price Display',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl },
        suggestion: '',
      };
    }

    return {
      module: this.moduleId,
      checkId: 'm5_tax_inclusive_display',
      title: 'Tax-Inclusive Price Display',
      status: 'not_detected',
      severity: 35,
      confidence: 'low',
      evidence: { url: this.crawler.baseUrl },
      suggestion: 'No "incl. VAT" or "excl. VAT" labelling detected in page source. EU consumer law (Price Indication Directive) requires prices shown to consumers to include all taxes. If selling to EU/UK, confirm your theme displays tax-inclusive prices.',
    };
  }

  private checkOssVatmoss(html: string): Finding {
    const patterns = [
      /\boss\b.*\bvat\b|\bvat\b.*\boss\b/i,    // OSS VAT
      /one[\s-]stop[\s-]shop/i,
      /\bvatmoss\b/i,
      /\bvat\s+moss\b/i,
      /digital\s+services?\s+(?:vat|tax)/i,
    ];

    const found = patterns.some(p => p.test(html));
    if (found) {
      return {
        module: this.moduleId,
        checkId: 'm5_oss_vatmoss',
        title: 'EU OSS / VAT-MOSS Registration Signal',
        status: 'pass',
        severity: 0,
        confidence: 'low',
        evidence: { url: this.crawler.baseUrl },
        suggestion: '',
      };
    }

    return {
      module: this.moduleId,
      checkId: 'm5_oss_vatmoss',
      title: 'EU OSS / VAT-MOSS Registration Signal',
      status: 'not_detected',
      severity: 20,
      confidence: 'low',
      evidence: { url: this.crawler.baseUrl },
      suggestion: 'No EU OSS (One-Stop Shop) or VAT-MOSS signal detected. If you sell digital goods or ship physical goods exceeding €10,000/year to EU customers, you must register for the EU OSS scheme.',
    };
  }
}
