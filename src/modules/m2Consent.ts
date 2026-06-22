import * as cheerio from 'cheerio';
import { BaseModule } from './base';
import type { Finding } from '../types';

interface CmpSignature {
  name: string;
  pattern: RegExp;
}

interface TrackerSignature {
  name: string;
  pattern: RegExp;
}

const CMP_SIGNATURES: CmpSignature[] = [
  { name: 'Cookiebot', pattern: /cookiebot\.com|CookieConsent/i },
  { name: 'OneTrust', pattern: /onetrust|optanon|cookielaw\.org/i },
  { name: 'Didomi', pattern: /didomi\.io|didomiOnReady/i },
  { name: 'Osano', pattern: /osano\.com/i },
  { name: 'Termly', pattern: /termly\.io/i },
  { name: 'iubenda', pattern: /iubenda\.com/i },
  { name: 'Usercentrics', pattern: /usercentrics\.eu|usercentrics\.com/i },
  { name: 'Shopify customerPrivacy', pattern: /customerPrivacy|Shopify\.customerPrivacy/i },
  { name: 'CookieYes', pattern: /cookieyes\.com|cky-consent/i },
];

const TRACKER_SIGNATURES: TrackerSignature[] = [
  { name: 'Google Analytics 4', pattern: /gtag\s*\(|googletagmanager\.com\/gtag|G-[A-Z0-9]{8,}/i },
  { name: 'Google Tag Manager', pattern: /googletagmanager\.com\/gtm|GTM-[A-Z0-9]{6,}/i },
  { name: 'Meta Pixel', pattern: /connect\.facebook\.net.*fbevents|fbq\s*\(/i },
  { name: 'TikTok Pixel', pattern: /analytics\.tiktok\.com|ttq\s*\./i },
  { name: 'Klaviyo', pattern: /klaviyo\.com|_learnq\s*\./i },
  { name: 'Pinterest Tag', pattern: /pintrk\s*\(|ct\.pinterest\.com/i },
  { name: 'Snapchat Pixel', pattern: /sc-static\.net|snaptr\s*\(/i },
  { name: 'Hotjar', pattern: /hotjar\.com|hjid\s*:|hj\s*\(/i },
  { name: 'Segment', pattern: /segment\.io|cdn\.segment\.com|analytics\.identify/i },
];

const CONSENT_SIGNALS = [
  /cookie\s*(?:consent|banner|notice|modal|dialog)/i,
  /privacy\s*(?:consent|notice|settings)/i,
  /gdpr/i,
  /data-consent/i,
];

export class ConsentTrackingModule extends BaseModule {
  readonly moduleId = 'consent_tracking';

  async run(): Promise<Finding[]> {
    const findings: Finding[] = [];
    let html = '';

    try {
      const result = await this.crawler.get('/');
      html = result.text;
    } catch (err) {
      findings.push({
        module: this.moduleId,
        checkId: 'm2_cmp_present',
        title: 'Consent Management Platform',
        status: 'error',
        severity: 0,
        confidence: 'low',
        evidence: { url: this.crawler.baseUrl, value: String(err) },
        suggestion: 'Could not fetch homepage to check for CMP.',
      });
      return findings;
    }

    findings.push(this.checkCmp(html));
    findings.push(...this.checkTrackers(html));
    findings.push(this.checkGdprPrivacyLink(html));
    findings.push(this.checkCcpaOptOut(html));

    return findings.filter(Boolean) as Finding[];
  }

  private checkCmp(html: string): Finding {
    const found = CMP_SIGNATURES.find(sig => sig.pattern.test(html));
    const hasConsentSignal = CONSENT_SIGNALS.some(p => p.test(html));

    if (found) {
      return {
        module: this.moduleId,
        checkId: 'm2_cmp_present',
        title: 'Consent Management Platform',
        status: 'pass',
        severity: 0,
        confidence: 'high',
        evidence: { url: this.crawler.baseUrl, value: found.name },
        suggestion: '',
      };
    }

    if (hasConsentSignal) {
      return {
        module: this.moduleId,
        checkId: 'm2_cmp_present',
        title: 'Consent Management Platform',
        status: 'warn',
        severity: 60,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl, value: 'Generic consent signal found, no recognised CMP' },
        suggestion: 'A known CMP was not detected, but consent-related markup is present. Verify your CMP is correctly loaded on all pages.',
      };
    }

    return {
      module: this.moduleId,
      checkId: 'm2_cmp_present',
      title: 'Consent Management Platform',
      status: 'not_detected',
      severity: 75,
      confidence: 'medium',
      evidence: { url: this.crawler.baseUrl },
      suggestion: 'No Consent Management Platform detected. Install a GDPR-compliant CMP (e.g. Cookiebot, OneTrust, or Shopify\'s built-in customerPrivacy API) before advertising to EU/UK customers.',
    };
  }

  private checkTrackers(html: string): Finding[] {
    const detected = TRACKER_SIGNATURES.filter(sig => sig.pattern.test(html));
    if (!detected.length) return [];

    const cmpFound = CMP_SIGNATURES.some(sig => sig.pattern.test(html));
    const hasConsentSignal = CONSENT_SIGNALS.some(p => p.test(html));

    if (cmpFound || hasConsentSignal) {
      return detected.map(t => ({
        module: this.moduleId,
        checkId: `m2_tracker_${t.name.toLowerCase().replace(/\s+/g, '_')}`,
        title: `Tracker: ${t.name}`,
        status: 'pass' as const,
        severity: 0,
        confidence: 'medium' as const,
        evidence: { url: this.crawler.baseUrl, value: t.name },
        suggestion: '',
      }));
    }

    return detected.map(t => ({
      module: this.moduleId,
      checkId: `m2_tracker_${t.name.toLowerCase().replace(/\s+/g, '_')}`,
      title: `Tracker Without Consent Gate: ${t.name}`,
      status: 'fail' as const,
      severity: 88,
      confidence: 'medium' as const,
      evidence: { url: this.crawler.baseUrl, value: t.name },
      suggestion: `${t.name} loads on every page visit before any cookie consent is collected. EU/UK visitors can report this. Add a CMP (Cookiebot, OneTrust, or Shopify's consent API) and move this script behind the consent banner.`,
    }));
  }

  private checkGdprPrivacyLink($html: string): Finding {
    const $ = cheerio.load($html);
    const links = $('a').toArray();
    let foundText = '';
    const hasPrivacyLink = links.some(el => {
      const href = $(el).attr('href') ?? '';
      const text = $(el).text().trim();
      const textLower = text.toLowerCase();
      if (href.includes('privacy') || textLower.includes('privacy') || textLower.includes('datenschutz')) {
        foundText = text || href;
        return true;
      }
      return false;
    });

    if (hasPrivacyLink) {
      return {
        module: this.moduleId,
        checkId: 'm2_privacy_link',
        title: 'Privacy Policy Link in Footer',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl, value: `Link found: "${foundText}"` },
        suggestion: '',
      };
    }

    return {
      module: this.moduleId,
      checkId: 'm2_privacy_link',
      title: 'Privacy Policy Link in Footer',
      status: 'not_detected',
      severity: 55,
      confidence: 'medium',
      evidence: { url: this.crawler.baseUrl },
      suggestion: 'Add a visible link to your Privacy Policy in the footer. GDPR Article 13 requires privacy information to be easily accessible.',
    };
  }

  private checkCcpaOptOut(html: string): Finding {
    const ccpaPatterns = [
      /do not sell\s+(?:or share\s+)?(?:my\s+)?(?:personal\s+)?information/i,
      /do not sell or share\b/i,
      /opt.?out\s+of\s+(?:sale|selling)/i,
      /your\s+privacy\s+choices/i,
      /california\s+privacy\s+rights/i,
      /ccpa/i,
    ];

    let matchedText = '';
    const found = ccpaPatterns.some(p => {
      const match = html.match(p);
      if (match) {
        matchedText = match[0];
        return true;
      }
      return false;
    });

    if (found) {
      return {
        module: this.moduleId,
        checkId: 'm2_ccpa_opt_out',
        title: 'CCPA/CPRA "Do Not Sell or Share" Link',
        status: 'pass',
        severity: 0,
        confidence: 'medium',
        evidence: { url: this.crawler.baseUrl, value: `Detected CCPA language: "${matchedText}"` },
        suggestion: '',
      };
    }

    return {
      module: this.moduleId,
      checkId: 'm2_ccpa_opt_out',
      title: 'CCPA/CPRA "Do Not Sell or Share" Link',
      status: 'not_detected',
      severity: 50,
      confidence: 'low',
      evidence: { url: this.crawler.baseUrl },
      suggestion: 'If you sell to California residents and share data with third parties for advertising, you must provide a "Do Not Sell or Share My Personal Information" link under CCPA/CPRA.',
    };
  }
}
