import * as cheerio from 'cheerio';
import { BaseModule } from './base';
import type { Finding, Evidence } from '../types';
import { judgeWithdrawalClause } from '../llm';

interface PolicySpec {
  path: string;
  checkId: string;
  title: string;
  severity: number;
}

// Severities match PRD §5: privacy≈92, withdrawal≈88, returns≈82, imprint≈80, terms≈75
const POLICIES: PolicySpec[] = [
  { path: '/policies/refund-policy',    checkId: 'm1_refund_policy',    title: 'Refund / Returns Policy', severity: 82 },
  { path: '/policies/privacy-policy',   checkId: 'm1_privacy_policy',   title: 'Privacy Policy',          severity: 92 },
  { path: '/policies/terms-of-service', checkId: 'm1_terms_of_service', title: 'Terms of Service',        severity: 75 },
  { path: '/policies/shipping-policy',  checkId: 'm1_shipping_policy',  title: 'Shipping Policy',         severity: 60 },
];

const WITHDRAWAL_PATTERNS = [
  /\b14[\s\-]?days?\b/i,
  /\bwithdraw(?:al)?\b/i,
  /\bwiderruf/i,
  /\bcooling[\s\-]off\b/i,
  /\bright\s+to\s+cancel\b/i,
  /\bconsumer\s+rights\s+directive\b/i,
];

// US-state privacy opt-out signals (CCPA/CPRA/state law)
const US_OPT_OUT_PATTERNS = [
  /opt[\s\-]out/i,
  /do not sell/i,
  /\bGPC\b/,                      // Global Privacy Control
  /global privacy control/i,
  /your privacy (?:rights|choices)/i,
  /right to opt.?out/i,
];

// EU legal imprint (Impressum) signals
const VAT_ID_PATTERNS = [
  /\b[A-Z]{2}\s*\d{9,12}\b/,         // EU VAT format e.g. DE123456789
  /vat\s*(?:no|number|reg)[.:\s]*\S+/i,
  /umsatzsteuer[\s-]?id/i,
  /btw[\s-]?nummer/i,
  /siret|siren\b/i,
];

export class LegalPagesModule extends BaseModule {
  readonly moduleId = 'legal_pages';

  async run(): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const spec of POLICIES) {
      const finding = await this.checkPolicy(spec);
      findings.push(finding);
    }

    const refundFinding = findings.find(f => f.checkId === 'm1_refund_policy');
    if (refundFinding?.status === 'pass') {
      const withdrawalFinding = await this.checkWithdrawalClause(
        refundFinding.evidence.url ?? `${this.crawler.baseUrl}/policies/refund-policy`
      );
      if (withdrawalFinding) findings.push(withdrawalFinding);
    } else if (refundFinding?.status === 'not_detected') {
      findings.push({
        module: this.moduleId,
        checkId: 'm1_eu_withdrawal',
        title: 'Right of Withdrawal Clause (EU/UK)',
        status: 'not_detected',
        severity: 85,
        confidence: 'low',
        evidence: { url: refundFinding.evidence.url, value: 'Parent policy blocked by robots.txt' },
        suggestion: `Cannot verify withdrawal clause because ${new URL(this.crawler.baseUrl).hostname}'s robots.txt blocks access to the refund policy.`,
      });
    }

    const privacyFinding = findings.find(f => f.checkId === 'm1_privacy_policy');
    if (privacyFinding?.status === 'pass') {
      const optOutFinding = await this.checkPrivacyOptOut(
        privacyFinding.evidence.url ?? `${this.crawler.baseUrl}/policies/privacy-policy`
      );
      if (optOutFinding) findings.push(optOutFinding);
    } else if (privacyFinding?.status === 'not_detected') {
      findings.push({
        module: this.moduleId,
        checkId: 'm1_us_opt_out',
        title: 'CCPA/CPRA "Do Not Sell or Share" Link',
        status: 'not_detected',
        severity: 75,
        confidence: 'low',
        evidence: { url: privacyFinding.evidence.url, value: 'Parent policy blocked by robots.txt' },
        suggestion: `Cannot verify CCPA/CPRA opt-out because ${new URL(this.crawler.baseUrl).hostname}'s robots.txt blocks access to the privacy policy.`,
      });
    }

    const imprintFinding = await this.checkEuImprint();
    findings.push(imprintFinding);

    return findings;
  }

  private async checkPolicy(spec: PolicySpec): Promise<Finding> {
    const url = `${this.crawler.baseUrl}${spec.path}`;
    try {
      const result = await this.crawler.get(spec.path);

      if (result.status >= 400) {
        return {
          module: this.moduleId,
          checkId: spec.checkId,
          title: spec.title,
          status: 'fail',
          severity: spec.severity,
          confidence: 'high',
          evidence: { url, value: `HTTP ${result.status}` },
          suggestion: `Create a ${spec.title} page at ${spec.path}. This is required for selling internationally.`,
        };
      }

      const text = cheerio.load(result.text).text();
      if (text.trim().length < 100) {
        return {
          module: this.moduleId,
          checkId: spec.checkId,
          title: spec.title,
          status: 'warn',
          severity: Math.round(spec.severity * 0.5),
          confidence: 'medium',
          evidence: { url, snippet: text.slice(0, 200) },
          suggestion: `${spec.title} page exists but has very little content. Review and expand it.`,
        };
      }

      return {
        module: this.moduleId,
        checkId: spec.checkId,
        title: spec.title,
        status: 'pass',
        severity: 0,
        confidence: 'high',
        evidence: { url, value: `Page found and verified (HTTP 200, content length adequate)` },
        suggestion: '',
      };
    } catch (err) {
      const isRobots = String(err).includes('robots.txt');
      return {
        module: this.moduleId,
        checkId: spec.checkId,
        title: spec.title,
        status: isRobots ? 'not_detected' : 'error',
        severity: isRobots ? spec.severity : 0,
        confidence: 'low',
        evidence: { url, value: String(err) },
        suggestion: isRobots
          ? `${new URL(this.crawler.baseUrl).hostname}'s robots.txt file blocks access to ${spec.path}. We cannot automatically verify this policy.`
          : `Could not reach ${spec.path}. Verify the URL is accessible.`,
      };
    }
  }

  private async checkWithdrawalClause(refundUrl: string): Promise<Finding | null> {
    try {
      const result = await this.crawler.get(refundUrl.replace(this.crawler.baseUrl, ''));
      const $ = cheerio.load(result.text);
      const bodyText = $.text();

      const llmResult = await judgeWithdrawalClause(bodyText);

      if (llmResult !== null) {
        return this.withdrawalFindingFromLlm(refundUrl, llmResult);
      }

      return this.withdrawalFindingFromRegex(refundUrl, bodyText);
    } catch {
      return null;
    }
  }

  private withdrawalFindingFromLlm(url: string, verdict: {
    sufficient: boolean;
    foundElements: string[];
    missingElements: string[];
    citedText: string;
    reasoning: string;
  }): Finding {
    if (verdict.sufficient) {
      const foundList = verdict.foundElements.length > 0
        ? `Found: ${verdict.foundElements.join('; ')}`
        : 'All 4 required elements present';
      return {
        module: this.moduleId,
        checkId: 'm1_eu_withdrawal',
        title: 'EU 14-Day Withdrawal Clause',
        status: 'pass',
        severity: 0,
        confidence: 'high',
        evidence: { url, snippet: verdict.citedText || undefined, value: foundList },
        suggestion: '',
        tools: ['llm:gemini-flash'],
      };
    }

    const missing = verdict.missingElements.join(', ');
    return {
      module: this.moduleId,
      checkId: 'm1_eu_withdrawal',
      title: 'EU 14-Day Withdrawal Clause',
      status: 'fail',
      severity: 88,
      confidence: 'high',
      evidence: { url, snippet: verdict.citedText || undefined, value: `Missing: ${missing}` },
      suggestion: `Add an EU withdrawal clause covering: ${missing}. This is mandatory under the EU Consumer Rights Directive for sales to EU customers.`,
      tools: ['llm:gemini-flash'],
    };
  }

  private withdrawalFindingFromRegex(url: string, text: string): Finding {
    const matched = WITHDRAWAL_PATTERNS.filter(p => p.test(text));

    if (matched.length >= 2) {
      const snippetMatch = text.match(/.{0,100}(14.{0,10}day|withdrawal|widerruf|cooling.off).{0,100}/i);
      return {
        module: this.moduleId,
        checkId: 'm1_eu_withdrawal',
        title: 'EU 14-Day Withdrawal Clause',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url, snippet: snippetMatch?.[0]?.trim(), value: 'Withdrawal language detected via keyword matching (14-day, withdrawal, cooling-off)' },
        suggestion: '',
      };
    }

    const evidence: Evidence = { url };
    if (matched.length === 1) {
      const hint = text.match(/.{0,80}(14.{0,10}day|withdrawal|widerruf|cooling.off).{0,80}/i);
      evidence.snippet = hint?.[0]?.trim();
      evidence.value = 'Partial match — clause may be incomplete';
    }

    return {
      module: this.moduleId,
      checkId: 'm1_eu_withdrawal',
      title: 'EU 14-Day Withdrawal Clause',
      status: matched.length === 0 ? 'fail' : 'warn',
      severity: matched.length === 0 ? 88 : 50,
      confidence: 'medium',
      evidence,
      suggestion: 'Add an EU 14-day withdrawal/cancellation clause to your returns policy covering: (1) 14-day window from delivery, (2) right to cancel without reason, (3) who pays return shipping, (4) refund timeline of 14 days from cancellation notice.',
    };
  }

  /** Check privacy policy for US-state opt-out language (CCPA/CPRA). */
  private async checkPrivacyOptOut(privacyUrl: string): Promise<Finding | null> {
    try {
      const path = privacyUrl.replace(this.crawler.baseUrl, '');
      const result = await this.crawler.get(path);
      const text = cheerio.load(result.text).text();

      const found = US_OPT_OUT_PATTERNS.some(p => p.test(text));
      if (found) {
        return {
          module: this.moduleId,
          checkId: 'm1_us_opt_out',
          title: 'US-State Privacy Opt-Out Language',
          status: 'pass',
          severity: 0,
          confidence: 'medium',
          evidence: { url: privacyUrl },
          suggestion: '',
        };
      }

      return {
        module: this.moduleId,
        checkId: 'm1_us_opt_out',
        title: 'US-State Privacy Opt-Out Language',
        status: 'warn',
        severity: 55,
        confidence: 'medium',
        evidence: { url: privacyUrl, value: 'No opt-out / do-not-sell / GPC language detected' },
        suggestion: 'If selling to US residents (especially California), add "Do Not Sell or Share My Personal Information" and Global Privacy Control (GPC) opt-out language to your Privacy Policy as required by CCPA/CPRA.',
      };
    } catch {
      return null;
    }
  }

  /** Check for EU legal imprint (Impressum) via homepage footer scan. */
  private async checkEuImprint(): Promise<Finding> {
    const homeUrl = this.crawler.baseUrl;
    try {
      const result = await this.crawler.get('/');
      const $ = cheerio.load(result.text);

      // Check for link to /pages/impressum or text "Impressum" in any link/footer
      const hasImpressumLink = $('a').toArray().some(el => {
        const href = $(el).attr('href') ?? '';
        const text = $(el).text();
        return href.includes('impressum') || /impressum/i.test(text);
      });

      // Check footer text for VAT ID patterns
      const footerText = $('footer').text() + $('[class*="footer"]').text();
      const hasVatId = VAT_ID_PATTERNS.some(p => p.test(footerText));

      if (hasImpressumLink || hasVatId) {
        return {
          module: this.moduleId,
          checkId: 'm1_eu_imprint',
          title: 'EU Legal Imprint (Impressum)',
          status: 'pass',
          severity: 0,
          confidence: 'medium',
          evidence: {
            url: homeUrl,
            value: hasImpressumLink ? 'Impressum link found' : 'VAT/company registration number found in footer',
          },
          suggestion: '',
        };
      }

      return {
        module: this.moduleId,
        checkId: 'm1_eu_imprint',
        title: 'EU Legal Imprint (Impressum)',
        status: 'not_detected',
        severity: 80,
        confidence: 'medium',
        evidence: { url: homeUrl, value: 'No Impressum link or VAT/company registration number detected in footer' },
        suggestion: 'Add a legal imprint (Impressum) page at /pages/impressum and link it in your footer. German/Austrian/Swiss law requires this for commercial websites; other EU states have similar obligations. Include company name, address, VAT/registration number, and contact details.',
      };
    } catch (err) {
      return {
        module: this.moduleId,
        checkId: 'm1_eu_imprint',
        title: 'EU Legal Imprint (Impressum)',
        status: 'error',
        severity: 0,
        confidence: 'low',
        evidence: { url: homeUrl, value: String(err) },
        suggestion: 'Could not fetch homepage to check for EU legal imprint.',
      };
    }
  }
}
