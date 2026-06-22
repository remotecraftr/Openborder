import React, { useState, useRef } from 'react';
import type { NextPage } from 'next';
import Head from 'next/head';
import type { AuditResult, Finding } from '../src/types';

// ── Types ──────────────────────────────────────────────────────────────────────
type Step = 'domain' | 'intake' | 'analysis' | 'results';

interface IntakeAnswers {
  markets: string[];
  sell: string;
  channel: string;
  ptype: string;
  category: string;
  inventory: string;
  revenue: string;
  employees: string;
  email: string;
  sensitive: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const DEFAULT_ANSWERS: IntakeAnswers = {
  markets: ['EU', 'UK', 'US'],
  sell: 'B2C',
  channel: 'own',
  ptype: 'Physical',
  category: 'General',
  inventory: 'import',
  revenue: '2to10',
  employees: 'gte10',
  email: 'yes',
  sensitive: 'no',
};

const FORM_GROUPS = [
  {
    g: 'Markets', ix: 'A', qs: [
      { k: 'markets', label: 'Where do you sell? (ship-to + actively target)', gate: 'gates everything', multi: true,
        opts: [['EU','European Union'],['UK','United Kingdom'],['US','United States'],['CA','Canada'],['AU','Australia']] },
    ],
  },
  {
    g: 'Business model', ix: 'B', qs: [
      { k: 'sell', label: 'Who do you sell to?', gate: 'tier-1 gate', multi: false,
        opts: [['B2C','Consumers (B2C)'],['B2B','Businesses (B2B)'],['Both','Both']] },
      { k: 'channel', label: 'Sales channel', multi: false,
        opts: [['own','Own store'],['marketplace','Marketplace'],['both','Both']] },
    ],
  },
  {
    g: 'Product', ix: 'C', qs: [
      { k: 'ptype', label: 'What do you sell?', gate: 'tier-1 gate', multi: false,
        opts: [['Physical','Physical goods'],['Digital','Digital products'],['Services','Services']] },
      { k: 'category', label: 'Product category', multi: false,
        opts: [['General','Apparel / general'],['Cosmetics','Cosmetics'],['Toys','Toys'],['Electronics','Electronics'],['Food','Food / supplements'],['Medical','Medical']] },
      { k: 'inventory', label: 'Where does stock ship from?', multi: false,
        opts: [['import','From outside destination'],['instock','In-market stock'],['both','Both']] },
    ],
  },
  {
    g: 'Scale', ix: 'D', qs: [
      { k: 'revenue', label: 'Annual revenue', multi: false,
        opts: [['lt2','Under €2M'],['2to10','€2M – €10M'],['gt10','Over €10M']] },
      { k: 'employees', label: 'Employees', multi: false,
        opts: [['lt10','Under 10'],['gte10','10 or more']] },
    ],
  },
  {
    g: 'Data & marketing', ix: 'E', qs: [
      { k: 'email', label: 'Run email / SMS marketing?', multi: false,
        opts: [['yes','Yes'],['no','No']] },
      { k: 'sensitive', label: 'Collect health, biometric, or under-16 data?', multi: false,
        opts: [['yes','Yes'],['no','No']] },
    ],
  },
];

interface ScanStep { text: string }
interface ScanModuleDef { id: string; label: string; accent: string; steps: ScanStep[] }

const SCAN_MODULES: ScanModuleDef[] = [
  {
    id: 'M1', label: 'Legal Pages', accent: '#e8756a',
    steps: [
      { text: 'Checking Refund / Return policy'         },
      { text: 'Checking Privacy policy'                  },
      { text: 'Checking Terms of service'                },
      { text: 'Detecting EU withdrawal rights clause'    },
      { text: 'Checking for EU imprint / impressum'     },
    ],
  },
  {
    id: 'M2', label: 'Consent & Tracking', accent: '#e9b15a',
    steps: [
      { text: 'Scanning for consent management platform' },
      { text: 'Detecting third-party trackers'           },
      { text: 'Checking GDPR / CCPA opt-out signals'    },
    ],
  },
  {
    id: 'M3', label: 'Localisation', accent: '#5fd39d',
    steps: [
      { text: 'Checking hreflang tags'                   },
      { text: 'Detecting currency selector'              },
      { text: 'Probing Shopify localization form'        },
      { text: 'Checking enabled currencies'              },
    ],
  },
  {
    id: 'M4', label: 'Accessibility (axe-core)', accent: '#7ab4f5',
    steps: [
      { text: 'Loading homepage in headless browser'     },
      { text: 'Running axe-core on homepage'             },
      { text: 'Loading product page in browser'          },
      { text: 'Running axe-core on product page'         },
    ],
  },
];

// Flat sequence of items to animate: module header then its steps
type ScanItem =
  | { kind: 'module'; mod: ScanModuleDef; mi: number }
  | { kind: 'step';   mod: ScanModuleDef; mi: number; si: number; step: ScanStep };

const SCAN_ITEMS: ScanItem[] = SCAN_MODULES.flatMap((mod, mi) => [
  { kind: 'module' as const, mod, mi },
  ...mod.steps.map((step, si) => ({ kind: 'step' as const, mod, mi, si, step })),
]);

const DEMO = ['allbirds.com', 'gymshark.com', 'drmtlgy.com'];

// Module → markets for per-market scoring
const MODULE_MARKETS: Record<string, string[]> = {
  legal_pages:      ['EU', 'UK', 'US', 'CA', 'AU'],
  consent_tracking: ['EU', 'UK', 'US'],
  localization:     ['EU', 'UK', 'CA', 'AU'],
  accessibility:    ['EU'],
  tax_display:      ['EU', 'UK'],
};

// Module weights — mirrors the backend scoring engine
const MODULE_WEIGHTS: Record<string, number> = {
  legal_pages:      1.0,
  consent_tracking: 0.9,
  accessibility:    0.6,
  localization:     0.5,
  tax_display:      0.4,
};

// Per-check market scope (more precise than module-level)
const CHECK_MARKETS: Record<string, string[]> = {
  m1_refund_policy:      ['EU', 'UK'],
  m1_privacy_policy:     ['EU', 'UK', 'US', 'CA', 'AU'],
  m1_terms_of_service:   ['EU', 'UK', 'US'],
  m1_shipping_policy:    ['EU', 'UK', 'US', 'CA', 'AU'],
  m1_eu_withdrawal:      ['EU', 'UK'],
  m1_us_opt_out:         ['US', 'CA'],
  m1_eu_imprint:         ['EU'],
  m2_cmp_present:        ['EU', 'UK'],
  m2_privacy_link:       ['EU', 'UK', 'US'],
  m2_ccpa_opt_out:       ['US', 'CA'],
  m3_hreflang:           ['EU', 'UK', 'US', 'CA', 'AU'],
  m3_localization_form:  ['EU', 'UK', 'US', 'CA', 'AU'],
  m3_currency_selector:  ['EU', 'UK', 'US', 'CA', 'AU'],
  m3_enabled_currencies: ['EU', 'UK', 'US', 'CA', 'AU'],
};

// Plain-language context replacing severity numbers
const CHECK_CONTEXT: Record<string, string> = {
  m1_refund_policy:      'Required to sell internationally',
  m1_privacy_policy:     'Legal requirement in all target markets',
  m1_terms_of_service:   'Legal requirement',
  m1_shipping_policy:    'Expected by international customers',
  m1_eu_withdrawal:      'EU / UK Consumer Rights Directive',
  m1_us_opt_out:         'California CCPA / CPRA',
  m1_eu_imprint:         'German law (§5 DDG) & equivalent EU states',
  m2_cmp_present:        'Required before advertising to EU / UK customers',
  m2_privacy_link:       'GDPR Article 13 — easy access to privacy info',
  m2_ccpa_opt_out:       'Required if selling to California residents',
  m3_hreflang:           'International SEO & search routing',
  m3_localization_form:  'Lets customers switch market or language',
  m3_currency_selector:  'Local currency display for international shoppers',
  m3_enabled_currencies: 'Multi-currency checkout experience',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function isFixNow(f: Finding): boolean {
  return f.status === 'fail' && f.severity >= 80;
}

function scColor(s: number): string {
  return s >= 80 ? 'var(--good)' : s >= 60 ? 'var(--seal)' : 'var(--crit)';
}

function getCheckMarkets(f: Finding): string[] {
  if (f.checkId in CHECK_MARKETS) return CHECK_MARKETS[f.checkId];
  if (f.checkId.startsWith('m2_tracker_')) return ['EU', 'UK'];
  if (f.checkId.startsWith('m4_axe_')) return ['EU'];
  return MODULE_MARKETS[f.module] ?? ['EU', 'UK', 'US', 'CA', 'AU'];
}

function getAffectedMarkets(finding: Finding, selected: string[]): string[] {
  return getCheckMarkets(finding).filter(m => selected.includes(m));
}

function getContext(finding: Finding): string {
  if (finding.checkId in CHECK_CONTEXT) return CHECK_CONTEXT[finding.checkId];
  if (finding.checkId.startsWith('m2_tracker_')) return 'GDPR — must not fire before user consent';
  if (finding.checkId.startsWith('m4_axe_')) return 'European Accessibility Act (EAA)';
  return '';
}

function marketStatusInfo(issues: Finding[]): { label: string; color: string; bg: string; border: string } {
  const hasFail = issues.some(f => f.status === 'fail');
  const hasHighSev = issues.some(f => f.severity >= 75);
  if (hasFail && hasHighSev) return { label: 'Blocked',    color: 'var(--crit)', bg: 'var(--crit-bg)',  border: '#efc8be' };
  if (hasFail)               return { label: 'At risk',    color: 'var(--high)', bg: 'var(--high-bg)',  border: '#e8ceaa' };
  if (issues.length > 0)     return { label: 'Needs work', color: 'var(--seal)', bg: 'var(--seal-soft)', border: '#e8d0a8' };
  return                            { label: 'Ready',      color: 'var(--good)', bg: 'var(--good-bg)',  border: '#b8dac8' };
}

function computeQualifiedOut(a: IntakeAnswers): Array<{ name: string; why: string }> {
  const has  = (m: string) => a.markets.includes(m);
  const anyMk = (...ms: string[]) => ms.some(has);
  const multi = a.markets.length > 1;

  const rules: Array<{ name: string; gate: () => true | string }> = [
    { name: 'Right of withdrawal disclosure',
      gate: () => a.sell === 'B2B' ? 'B2B-only' : (!anyMk('EU','UK') ? 'No EU/UK market selected' : true) },
    { name: 'EU withdrawal button (Dir 2023/2673)',
      gate: () => a.sell === 'B2B' ? 'B2B-only' : (!has('EU') ? 'EU not targeted' : true) },
    { name: 'Tax-inclusive price display (EU/UK)',
      gate: () => a.sell === 'B2B' ? 'B2B-only — consumer pricing rules don\'t apply' : (!anyMk('EU','UK') ? 'No EU/UK market' : true) },
    { name: 'Germany Impressum (legal imprint)',
      gate: () => !has('EU') ? 'EU / Germany not targeted' : true },
    { name: 'Accessibility (EAA / WCAG 2.1 AA)',
      gate: () => !has('EU') ? 'EU not targeted' : true },
    { name: 'CE / UKCA marking & sector rules',
      gate: () => a.ptype !== 'Physical' ? 'Not physical goods' : (!anyMk('EU','UK') ? 'No EU/UK market' : (a.category === 'General' ? 'Apparel / general — no sector marking regime' : true)) },
    { name: 'Customs & landed-cost handling',
      gate: () => a.ptype !== 'Physical' ? 'Not physical goods' : (a.inventory === 'instock' ? 'Stock held in-market — no import at point of sale' : true) },
    { name: 'GPSR EU Responsible Person',
      gate: () => a.ptype !== 'Physical' ? 'Not physical goods' : (!has('EU') ? 'EU not targeted' : true) },
    { name: 'Email / SMS marketing consent (CASL, PECR)',
      gate: () => a.email !== 'yes' ? 'No email / SMS marketing' : (!anyMk('CA','AU','US','UK') ? 'No CA/AU/US/UK market' : true) },
    { name: 'DSA trader transparency',
      gate: () => !has('EU') ? 'EU not targeted' : (a.channel === 'own' ? 'Own store only — marketplace rules don\'t apply' : true) },
    { name: 'Country picker / market routing',
      gate: () => !multi ? 'Single market — no routing needed' : true },
    { name: 'Statutory conformity guarantee',
      gate: () => a.sell === 'B2B' ? 'B2B-only' : (!anyMk('EU','UK','AU') ? 'No EU/UK/AU market' : true) },
  ];

  return rules.flatMap(r => {
    const res = r.gate();
    return res === true ? [] : [{ name: r.name, why: res }];
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function ScoreRing({ score }: { score: number }) {
  const r = 50;
  const circ = 2 * Math.PI * r;
  const color = score >= 80 ? 'var(--good)' : score >= 60 ? 'var(--seal)' : 'var(--crit)';
  return (
    <div style={{ position: 'relative', width: 118, height: 118, flexShrink: 0 }}>
      <svg width="118" height="118" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="59" cy="59" r={r} stroke="#22304c" strokeWidth="11" fill="none" />
        <circle cx="59" cy="59" r={r} stroke={color} strokeWidth="11" fill="none"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ * (1 - score / 100)}
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <b style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 34, lineHeight: 1 }}>{Math.round(score)}</b>
        <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, letterSpacing: '1.5px', color: '#9fb0cf', textTransform: 'uppercase', marginTop: 3 }}>Readiness</span>
      </div>
    </div>
  );
}


function MarketCard({ market, findings }: { market: string; findings: Finding[] }) {
  const issues = findings
    .filter(f => getAffectedMarkets(f, [market]).length > 0 && (f.status === 'fail' || f.status === 'warn' || f.status === 'not_detected'))
    .sort((a, b) => b.severity - a.severity);
  const info = marketStatusInfo(issues);
  const topIssues = issues.slice(0, 3);
  return (
    <div style={{ background: 'var(--card)', border: `1px solid ${info.border}`, borderRadius: 13, padding: '16px 18px', flex: '1 1 150px', minWidth: 140 }}>
      <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, letterSpacing: '1.4px', fontWeight: 500, color: 'var(--mut-2)', textTransform: 'uppercase', marginBottom: 8 }}>{market}</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', background: info.bg, color: info.color, border: `1px solid ${info.border}`, borderRadius: 7, padding: '5px 10px', marginBottom: 10 }}>
        <span style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 14, letterSpacing: '.2px' }}>{info.label}</span>
      </div>
      {topIssues.length > 0 ? topIssues.map(f => (
        <div key={f.checkId} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 5 }}>
          <span style={{ color: info.color, fontSize: 10, marginTop: 2, flexShrink: 0 }}>↳</span>
          <span style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.4 }}>{f.title}</span>
        </div>
      )) : (
        <div style={{ fontSize: 11.5, color: 'var(--good)', marginTop: 4 }}>All checks clear</div>
      )}
    </div>
  );
}

function FindingCard({ finding, selectedMarkets }: { finding: Finding; selectedMarkets: string[] }) {
  const [open, setOpen] = useState(false);
  const fixNow = isFixNow(finding);
  const markets = getAffectedMarkets(finding, selectedMarkets);
  const context = getContext(finding);

  const ICON: Record<string, { char: string; bg: string; color: string; border: string }> = {
    fail:         { char: '✕', bg: 'var(--crit-bg)', color: 'var(--crit)', border: '#efc8be' },
    warn:         { char: '!', bg: 'var(--high-bg)', color: 'var(--high)', border: '#e8ceaa' },
    not_detected: { char: '✕', bg: 'var(--crit-bg)', color: 'var(--crit)', border: '#efc8be' },
    pass:         { char: '✓', bg: 'var(--good-bg)', color: 'var(--good)', border: '#b8dac8' },
    error:        { char: '⚠', bg: '#fdf1ec',        color: 'var(--high)', border: 'var(--line)' },
    unverified:   { char: '?', bg: '#f0f2f7',        color: 'var(--mut)',  border: 'var(--line)' },
  };
  const icon = ICON[finding.status] ?? ICON.error;

  return (
    <div
      onClick={() => setOpen(v => !v)}
      style={{
        background: 'var(--card)',
        border: `1px solid ${fixNow ? '#eccabc' : 'var(--line)'}`,
        borderRadius: 12, padding: '14px 16px', cursor: 'pointer',
        boxShadow: fixNow ? '0 1px 3px rgba(194,64,47,.07)' : '0 1px 2px rgba(14,22,38,.03)',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: icon.bg, border: `1px solid ${icon.border}`, color: icon.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
          {icon.char}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{finding.title}</span>
            {fixNow && <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, letterSpacing: '.5px', background: 'var(--crit-bg)', color: 'var(--crit)', border: '1px solid #eccabc', borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase', fontWeight: 500 }}>fix now</span>}
            {markets.length > 0 && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {markets.map(m => (
                  <span key={m} style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9.5, letterSpacing: '.6px', background: '#f0f2f7', color: 'var(--mut)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase' }}>{m}</span>
                ))}
              </div>
            )}
          </div>
          {context && <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: 'var(--mut-2)', marginTop: 3 }}>{context}</div>}
          {finding.suggestion && <div style={{ fontSize: 13, color: '#43506a', marginTop: 6, lineHeight: 1.55 }}>{finding.suggestion}</div>}
        </div>
        <span style={{ color: 'var(--mut-2)', fontSize: 11, flexShrink: 0, alignSelf: 'center' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (finding.evidence?.url || finding.evidence?.value || finding.evidence?.snippet || finding.confidence !== 'high') && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-2)', paddingLeft: 42 }}>
          {(finding.evidence?.url || finding.evidence?.value || finding.evidence?.snippet) && (
            <>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--mut-2)', marginBottom: 5 }}>Evidence</div>
              {finding.evidence.url && <code style={{ fontSize: 11, background: '#f3f5f9', border: '1px solid var(--line-2)', borderRadius: 5, padding: '2px 7px', color: '#43506a', display: 'block', width: 'fit-content', marginBottom: 3 }}>{finding.evidence.url}</code>}
              {finding.evidence.value && <p style={{ fontSize: 12, color: 'var(--mut)', marginTop: 3 }}>{finding.evidence.value}</p>}
              {finding.evidence.snippet && <pre style={{ fontSize: 11, background: '#f3f5f9', border: '1px solid var(--line-2)', borderRadius: 6, padding: 8, color: 'var(--mut)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 3 }}>{finding.evidence.snippet}</pre>}
            </>
          )}
          {finding.confidence !== 'high' && <p style={{ fontSize: 11, color: 'var(--mut-2)', fontStyle: 'italic', marginTop: 4 }}>Confidence: {finding.confidence}</p>}
        </div>
      )}
    </div>
  );
}

function PassFindingRow({ finding, index, selectedMarkets }: { finding: Finding; index: number; selectedMarkets: string[] }) {
  const [open, setOpen] = useState(false);
  const markets = getAffectedMarkets(finding, selectedMarkets);
  const context = getContext(finding);
  const hasEvidence = !!(finding.evidence?.url || finding.evidence?.value || finding.evidence?.snippet);
  const hasTools = !!(finding.tools && finding.tools.length > 0);
  const hasDetails = hasEvidence || hasTools || finding.confidence !== 'high';

  return (
    <div
      style={{ borderTop: index > 0 ? '1px solid var(--line-2)' : undefined }}
    >
      <div
        onClick={() => hasDetails && setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
          cursor: hasDetails ? 'pointer' : 'default',
        }}
      >
        <span style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: 'var(--good-bg)', border: '1px solid #b8dac8',
          color: 'var(--good)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontWeight: 700, fontSize: 11,
        }}>✓</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{finding.title}</span>
          {context && <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10.5, color: 'var(--mut-2)', marginLeft: 8 }}>— {context}</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {markets.map(m => (
            <span key={m} style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: 'var(--mut-2)', background: '#f0f2f7', border: '1px solid var(--line-2)', borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase' }}>{m}</span>
          ))}
          {hasDetails && <span style={{ color: 'var(--mut-2)', fontSize: 10, marginLeft: 4 }}>{open ? '▲' : '▼'}</span>}
        </div>
      </div>

      {open && hasDetails && (
        <div style={{
          marginLeft: 32, marginBottom: 8, padding: '10px 14px',
          background: '#f7faf8', border: '1px solid #d8e8df', borderRadius: 8,
        }}>
          <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--good)', marginBottom: 8 }}>
            Proof of check
          </div>

          {finding.evidence?.url && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: 'var(--mut-2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>URL checked </span>
              <code style={{ fontSize: 11.5, background: '#eef3f0', border: '1px solid #d4e2da', borderRadius: 5, padding: '2px 8px', color: '#2a5e42', display: 'inline-block', marginTop: 2, wordBreak: 'break-all' }}>{finding.evidence.url}</code>
            </div>
          )}

          {finding.evidence?.value && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: 'var(--mut-2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>What was found </span>
              <p style={{ fontSize: 12.5, color: 'var(--ink)', marginTop: 2, lineHeight: 1.5 }}>{finding.evidence.value}</p>
            </div>
          )}

          {finding.evidence?.snippet && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: 'var(--mut-2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Cited text from page </span>
              <pre style={{ fontSize: 11, background: '#eef3f0', border: '1px solid #d4e2da', borderRadius: 6, padding: 8, color: '#3a6b52', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 3, maxHeight: 120, overflow: 'auto' }}>{finding.evidence.snippet}</pre>
            </div>
          )}

          {hasTools && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: 'var(--mut-2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Verified with </span>
              <div style={{ display: 'flex', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                {finding.tools!.map(t => (
                  <span key={t} style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, background: '#e5f1eb', color: 'var(--good)', border: '1px solid #b8dac8', borderRadius: 4, padding: '2px 7px' }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {finding.confidence !== 'high' && (
            <p style={{ fontSize: 11, color: 'var(--mut-2)', fontStyle: 'italic', marginTop: 4 }}>Confidence: {finding.confidence}</p>
          )}
        </div>
      )}
    </div>
  );
}
const Home: NextPage = () => {
  const [step, setStep]       = useState<Step>('domain');
  const [domain, setDomain]   = useState('');
  const [answers, setAnswers] = useState<IntakeAnswers>({ ...DEFAULT_ANSWERS });
  const [result, setResult]   = useState<AuditResult | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [visibleCount, setVisibleCount] = useState(0);
  const [filter, setFilter]   = useState('action');
  const [domainShake, setDomainShake] = useState(false);

  const apiDoneRef  = useRef(false);
  const animDoneRef = useRef(false);
  const apiDataRef  = useRef<AuditResult | null>(null);
  const apiErrRef   = useRef<string | null>(null);

  function go(s: Step) {
    setStep(s);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleDomainNext() {
    const clean = domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!clean) {
      setDomainShake(true);
      setTimeout(() => setDomainShake(false), 300);
      return;
    }
    setDomain(clean);
    go('intake');
  }

  function updateAnswer(key: string, val: string, multi: boolean) {
    setAnswers(prev => {
      const p = prev as unknown as Record<string, unknown>;
      if (multi) {
        const arr = [...p[key] as string[]];
        const i = arr.indexOf(val);
        if (i >= 0) { if (arr.length > 1) arr.splice(i, 1); }
        else arr.push(val);
        return { ...prev, [key]: arr };
      }
      return { ...prev, [key]: val };
    });
  }

  function startAnalysis() {
    go('analysis');
    setResult(null);
    setApiError(null);
    setVisibleCount(0);
    setScanProgress(0);
    apiDoneRef.current  = false;
    animDoneRef.current = false;
    apiDataRef.current  = null;
    apiErrRef.current   = null;

    const clean = domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

    // Real API call runs concurrently with animation
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: clean }),
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json() as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<AuditResult>;
      })
      .then(data => {
        apiDataRef.current = data;
        apiDoneRef.current = true;
        if (animDoneRef.current) finalize();
      })
      .catch(err => {
        apiErrRef.current  = String(err);
        apiDoneRef.current = true;
        if (animDoneRef.current) finalize();
      });

    // Reveal SCAN_ITEMS one by one (module headers then their steps)
    SCAN_ITEMS.forEach((_, i) => {
      setTimeout(() => {
        setVisibleCount(i + 1);
        setScanProgress(Math.round((i + 1) / SCAN_ITEMS.length * 100));
      }, i * 260 + 80);
    });

    // Animation done — wait for API if needed
    setTimeout(() => {
      animDoneRef.current = true;
      if (apiDoneRef.current) finalize();
    }, SCAN_ITEMS.length * 260 + 500);
  }

  function finalize() {
    if (apiDataRef.current) {
      setResult(apiDataRef.current);
      setFilter('action');
    }
    if (apiErrRef.current) setApiError(apiErrRef.current);
    go('results');
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const findings   = result?.findings ?? [];
  const fails      = findings.filter(f => f.status === 'fail').length;
  const warns      = findings.filter(f => f.status === 'warn').length;
  const passes     = findings.filter(f => f.status === 'pass').length;
  const notDet     = findings.filter(f => f.status === 'not_detected').length;
  const unverified = findings.filter(f => f.status === 'unverified').length;
  const fixNows    = findings.filter(isFixNow);
  const score      = result?.readinessScore ?? 0;

  const verdict = score >= 80
    ? { h: 'Cleared to scale',    p: 'Minor polish only — no launch blockers detected.' }
    : score >= 60
    ? { h: 'Conditional',         p: 'Launchable after the fix-now items are closed.' }
    : { h: 'Not launch-ready',    p: 'Hard blockers open in one or more target markets.' };

  const actionFindings     = findings.filter(f => f.status === 'fail' || f.status === 'warn' || f.status === 'not_detected');
  const unverifiedFindings = findings.filter(f => f.status === 'unverified');
  const passFindings       = findings.filter(f => f.status === 'pass');

  const filteredFindings = findings.filter(f => {
    if (filter === 'action')     return f.status === 'fail' || f.status === 'warn' || f.status === 'not_detected';
    if (filter === 'unverified') return f.status === 'unverified';
    if (filter === 'fix')        return isFixNow(f);
    if (filter === 'pass')       return f.status === 'pass';
    return f.status !== 'error';
  }).sort((a, b) => {
    const rank = (s: string) => {
      if (s === 'fail') return 5;
      if (s === 'warn') return 4;
      if (s === 'not_detected') return 3;
      if (s === 'unverified') return 2;
      if (s === 'pass') return 1;
      return 0;
    };
    if (rank(a.status) !== rank(b.status)) {
      return rank(b.status) - rank(a.status);
    }
    return b.severity - a.severity;
  });

  const qualifiedOut = computeQualifiedOut(answers);
  const stepNum = step === 'domain' ? 1 : step === 'intake' ? 2 : 3;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>OpenBorder — Readiness Console</title>
        <meta name="description" content="Cross-border launch readiness check for Shopify stores." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <style>{`
          :root {
            --ink:#0E1626; --ink-2:#172238; --paper:#EBEEF3; --card:#FFFFFF;
            --line:#DBE1EA; --line-2:#E7EBF1; --mut:#5C6B82; --mut-2:#8A98AD;
            --seal:#D9912B; --seal-soft:#F6ECD8;
            --crit:#C2402F; --crit-bg:#FBEAE6;
            --high:#B26412; --high-bg:#FBF1E1;
            --med:#8A6D12;  --med-bg:#FAF6E4;
            --low:#4E6B5C;  --low-bg:#EAF0EC;
            --good:#1F8A5B; --good-bg:#E5F1EB;
            --info:#39557F;
          }
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html { -webkit-text-size-adjust: 100%; }
          body {
            font-family: Inter, system-ui, sans-serif;
            background: var(--paper);
            color: var(--ink);
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
          }
          @keyframes fade { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
          @keyframes shake { 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
          .fade-in { animation: fade .4s ease both; }
          .shake   { animation: shake .3s; }
          details summary { list-style: none; }
          details summary::-webkit-details-marker { display: none; }
          @media (max-width: 720px) {
            .summary-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </Head>

      {/* ── Top bar ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, background: 'var(--ink)', color: '#fff', borderBottom: '1px solid #21304d' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 16 }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="1" y="1" width="20" height="20" rx="5" stroke="#D9912B" strokeWidth="1.5"/>
              <path d="M11 2.5v17M2.5 11h17" stroke="#D9912B" strokeWidth="1.2" opacity=".55"/>
              <circle cx="11" cy="11" r="4" stroke="#fff" strokeWidth="1.5"/>
            </svg>
            OpenBorder
            <small style={{ fontFamily: "'IBM Plex Mono'", fontWeight: 400, fontSize: 10, letterSpacing: '1.5px', color: '#92a3c1', textTransform: 'uppercase', borderLeft: '1px solid #2c3d5c', paddingLeft: 10, marginLeft: 2 }}>Readiness Console</small>
          </div>

          {/* Step indicator */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', fontFamily: "'IBM Plex Mono'", fontSize: 11, color: '#7e8fae' }}>
            {([['1','Domain'],['2','Intake'],['3','Findings']] as const).map(([n, label], i) => (
              <React.Fragment key={n}>
                {i > 0 && <span style={{ width: 14, height: 1, background: '#2a3a59', display: 'inline-block' }} />}
                <span style={{ color: stepNum >= i + 1 ? (stepNum === i + 1 ? '#e9d6b4' : '#9fb0cf') : '#7e8fae' }}>
                  <b style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 6, background: stepNum === i + 1 ? 'var(--seal)' : stepNum > i + 1 ? '#2c4060' : '#1d2c47', color: stepNum === i + 1 ? '#221606' : '#9fb0cf', fontWeight: 500, marginRight: 4 }}>{n}</b>
                  {label}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 22px 64px' }}>

        {/* ══════════ SCREEN 1: Domain ══════════ */}
        {step === 'domain' && (
          <div className="fade-in">
            <div style={{ background: 'var(--ink)', borderRadius: 20, padding: '48px 44px', color: '#fff', position: 'relative', overflow: 'hidden', boxShadow: '0 1px 2px rgba(14,22,38,.05),0 8px 24px rgba(14,22,38,.06)' }}>
              <div style={{ position: 'absolute', inset: 0, opacity: .5, background: 'repeating-linear-gradient(90deg,transparent 0 64px,rgba(255,255,255,.025) 64px 65px),radial-gradient(120% 80% at 80% -10%,rgba(217,145,43,.16),transparent 60%)', pointerEvents: 'none' }} />
              <div style={{ position: 'relative' }}>
                <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'var(--seal)', marginBottom: 18 }}>Cross-border launch check · Shopify</div>
                <h1 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 'clamp(28px,4.4vw,44px)', lineHeight: 1.04, letterSpacing: '-.5px', maxWidth: '15ch' }}>Is this store ready to sell across borders?</h1>
                <p style={{ color: '#aab9d4', marginTop: 16, maxWidth: '52ch', fontSize: 15 }}>Point us at a Shopify storefront. We crawl what the site reveals — tax display, consent, currency, legal pages, accessibility — then ask the handful of things a crawl can't see, and return a scored, prioritized fix list.</p>

                <div style={{ marginTop: 30, maxWidth: 560 }}>
                  <label style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase', color: '#8597b6', display: 'block', marginBottom: 8 }}>Storefront domain</label>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <div className={domainShake ? 'shake' : ''} style={{ flex: 1, minWidth: 240, display: 'flex', alignItems: 'center', background: '#0a111d', border: '1px solid #283a5b', borderRadius: 11, overflow: 'hidden' }}>
                      <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 13, color: '#6c7e9e', padding: '0 2px 0 14px', whiteSpace: 'nowrap' }}>https://</span>
                      <input
                        type="text"
                        value={domain}
                        onChange={e => setDomain(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleDomainNext()}
                        placeholder="shop.aurora-goods.com"
                        autoComplete="off"
                        spellCheck={false}
                        style={{ flex: 1, background: 'transparent', border: 0, outline: 0, color: '#fff', fontFamily: "'IBM Plex Mono'", fontSize: 15, padding: '14px 14px 14px 4px' }}
                      />
                    </div>
                    <button onClick={handleDomainNext} style={{ border: 0, cursor: 'pointer', fontFamily: 'Inter', fontWeight: 600, fontSize: 14, borderRadius: 11, padding: '14px 22px', background: 'var(--seal)', color: '#221606' }}>
                      Run readiness audit →
                    </button>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#8295b4', marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#8295b4" strokeWidth="1.3"/><path d="M8 5v3.5M8 11h.01" stroke="#8295b4" strokeWidth="1.4" strokeLinecap="round"/></svg>
                    Assumes a Shopify storefront. Nothing is changed on the site — read-only inspection.
                  </div>
                  <div style={{ marginTop: 16, fontFamily: "'IBM Plex Mono'", fontSize: 12, color: '#7185a5' }}>
                    Try a sample:{' '}
                    {DEMO.map(d => (
                      <button key={d} onClick={() => setDomain(d)} style={{ background: '#142036', border: '1px solid #2a3a5a', color: '#c7d4ea', borderRadius: 7, padding: '4px 9px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, marginLeft: 6 }}>{d}</button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginTop: 38, paddingTop: 24, borderTop: '1px solid #213149' }}>
                  {[['25','compliance checks'],['5','markets covered'],['fix now','vs nice-to-have']].map(([b, label]) => (
                    <div key={label} style={{ fontSize: 12.5, color: '#9aa9c6' }}>
                      <b style={{ display: 'block', fontFamily: "'Space Grotesk'", fontWeight: 700, color: '#fff', fontSize: 20, marginBottom: 2 }}>{b}</b>
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ SCREEN 2: Intake ══════════ */}
        {step === 'intake' && (
          <div className="fade-in">
            <div style={{ marginBottom: 26 }}>
              <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--seal)', fontWeight: 500 }}>Step 2 · Pre-qualification</div>
              <h2 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 26, letterSpacing: '-.3px', marginTop: 8 }}>A few things the crawl can't see</h2>
              <p style={{ color: 'var(--mut)', maxWidth: '60ch', marginTop: 6, fontSize: 14.5 }}>These answers decide which checks apply. The first three alone remove most of the matrix — a B2B-only digital seller skips withdrawal, returns, customs and product-safety entirely.</p>
            </div>

            {FORM_GROUPS.map(group => (
              <div key={group.ix} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '22px 22px 8px', marginBottom: 16, boxShadow: '0 1px 2px rgba(14,22,38,.05),0 8px 24px rgba(14,22,38,.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'IBM Plex Mono'", fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--mut-2)', marginBottom: 18 }}>
                  <span style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, color: 'var(--ink)', fontSize: 13, background: 'var(--seal-soft)', border: '1px solid #ecdcbd', borderRadius: 6, width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', letterSpacing: 0 }}>{group.ix}</span>
                  {group.g}
                </div>
                {group.qs.map((q: { k: string; label: string; gate?: string; multi: boolean; opts: string[][] }) => {
                  const val = (answers as unknown as Record<string, unknown>)[q.k];
                  return (
                    <div key={q.k} style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 9 }}>
                        {q.label}
                        {q.gate && <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, fontWeight: 500, color: 'var(--seal)', letterSpacing: '.5px', border: '1px solid #ecdcbd', background: 'var(--seal-soft)', borderRadius: 5, padding: '1px 6px', marginLeft: 8, textTransform: 'uppercase', verticalAlign: '1px' }}>{q.gate}</span>}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {q.opts.map(([optVal, optLabel]) => {
                          const selected = q.multi ? (val as string[]).includes(optVal) : val === optVal;
                          return (
                            <button
                              key={optVal}
                              type="button"
                              onClick={() => updateAnswer(q.k, optVal, q.multi)}
                              style={{
                                border: `1px solid ${selected ? (q.multi ? 'var(--seal)' : 'var(--ink)') : 'var(--line)'}`,
                                background: selected ? (q.multi ? 'var(--seal)' : 'var(--ink)') : '#fff',
                                color: selected ? (q.multi ? '#221606' : '#fff') : 'var(--ink)',
                                borderRadius: 9, padding: '9px 14px', fontSize: 13.5, cursor: 'pointer', fontWeight: 500, transition: 'all .12s',
                              }}
                            >
                              {optLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            <div style={{ position: 'sticky', bottom: 0, marginTop: 8, background: 'linear-gradient(transparent,var(--paper) 36%)', padding: '18px 0 4px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12.5, color: 'var(--mut)', maxWidth: '46ch' }}>Answers gate the findings. You can edit them after seeing results.</div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                <button onClick={() => go('domain')} style={{ border: '1px solid var(--line)', background: 'transparent', color: 'var(--mut)', borderRadius: 11, padding: '14px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter' }}>← Domain</button>
                <button onClick={startAnalysis} style={{ border: 0, background: 'var(--ink)', color: '#fff', borderRadius: 11, padding: '14px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter' }}>Run analysis →</button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ SCREEN 3a: Analysis animation ══════════ */}
        {step === 'analysis' && (
          <div className="fade-in" style={{ maxWidth: 760, margin: '6px auto' }}>
            <div style={{ background: 'var(--ink)', borderRadius: 18, padding: '34px 30px', color: '#dfe7f4', boxShadow: '0 1px 2px rgba(14,22,38,.05),0 8px 24px rgba(14,22,38,.06)' }}>
              <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 13, color: '#9fb0cf', marginBottom: 6 }}>Auditing <b style={{ color: '#fff' }}>{domain}</b> · read-only</div>
              <h3 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 22, color: '#fff', marginBottom: 22 }}>Running readiness scan</h3>
              <div>
                {SCAN_ITEMS.map((item, idx) => {
                  const vis = visibleCount > idx;
                  // The currently-revealing item is the last one that became visible
                  const isActive = visibleCount - 1 === idx;

                  if (item.kind === 'module') {
                    const stepsTotal = item.mod.steps.length;
                    const allStepsDone = visibleCount > idx + stepsTotal;
                    return (
                      <div key={`m${item.mi}`} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: '#162030', borderRadius: 8,
                        padding: '7px 12px', margin: idx === 0 ? '0 0 2px' : '10px 0 2px',
                        opacity: vis ? 1 : 0, transition: 'opacity .25s',
                      }}>
                        <span style={{
                          fontFamily: "'IBM Plex Mono'", fontSize: 9.5, fontWeight: 700,
                          letterSpacing: '1.2px', borderRadius: 4, padding: '2px 7px',
                          background: item.mod.accent + '22', color: item.mod.accent,
                          border: `1px solid ${item.mod.accent}44`,
                        }}>{item.mod.id}</span>
                        <span style={{ fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 13, color: '#e0e8f5' }}>{item.mod.label}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono'", fontSize: 10,
                          color: allStepsDone ? '#5fd39d' : '#e9b15a' }}>
                          {allStepsDone ? '✓ done' : '● running'}
                        </span>
                      </div>
                    );
                  }

                  // step item — past steps show ✓, active step pulses, no fake result status
                  const { step, si, mod } = item;
                  const isDone = vis && !isActive;
                  return (
                    <div key={`s${item.mi}-${si}`} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      fontFamily: "'IBM Plex Mono'", fontSize: 12.5,
                      padding: '8px 0 8px 14px',
                      borderBottom: si < mod.steps.length - 1 ? '1px solid #1c2a44' : undefined,
                      opacity: vis ? 1 : 0, transform: vis ? 'none' : 'translateX(-6px)',
                      transition: 'opacity .25s, transform .25s',
                    }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700,
                        background: isDone ? 'rgba(31,138,91,.2)' : 'rgba(100,140,200,.18)',
                        color: isDone ? '#5fd39d' : '#7ab4f5',
                        // pulse the active step
                        animation: isActive ? 'pulse 1s ease-in-out infinite' : undefined,
                      }}>{isDone ? '✓' : '›'}</span>
                      <span style={{ color: isDone ? '#a8bdd8' : '#e0e8f5' }}>{step.text}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ height: 4, background: '#16223a', borderRadius: 3, marginTop: 24, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${scanProgress}%`, background: 'linear-gradient(90deg,var(--seal),#f0c070)', transition: 'width .4s', borderRadius: 3 }} />
              </div>
            </div>
          </div>
        )}

        {/* ══════════ SCREEN 3b: Results ══════════ */}
        {step === 'results' && (
          <div className="fade-in">
            {/* Error state */}
            {apiError && (
              <div style={{ background: 'var(--crit-bg)', border: '1px solid #f0cfc7', color: 'var(--crit)', borderRadius: 12, padding: '16px 20px', marginBottom: 20, fontSize: 14 }}>
                {apiError}
                <button onClick={() => go('domain')} style={{ marginLeft: 16, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--crit)', textDecoration: 'underline', fontSize: 14 }}>Try another domain</button>
              </div>
            )}

            {result && (
              <>
                {/* ── Header ── */}
                <div style={{ marginBottom: 22 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--seal)', fontWeight: 500 }}>Step 3 · {domain}</div>
                  <h2 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 26, letterSpacing: '-.3px', marginTop: 6 }}>Launch readiness report</h2>
                </div>

                {/* ── Score + stats ── */}
                <div style={{ background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: '20px 24px', display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16, boxShadow: '0 1px 2px rgba(14,22,38,.05),0 8px 24px rgba(14,22,38,.06)' }}>
                  <ScoreRing score={score} />
                  <div>
                    <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--seal)' }}>Overall verdict</div>
                    <h3 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 20, margin: '5px 0 3px' }}>{verdict.h}</h3>
                    <p style={{ fontSize: 13, color: '#aab9d4', maxWidth: '32ch' }}>{verdict.p}</p>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                    {[
                      { val: fixNows.length, label: 'Fix right away', color: 'var(--crit)' },
                      { val: fails + notDet, label: 'Issues',         color: 'var(--high)' },
                      { val: warns,          label: 'Needs attention', color: '#d4af70' },
                      { val: unverified,     label: 'Unverified',     color: '#7e8fae' },
                      { val: passes,         label: 'Passing',        color: 'var(--good)' },
                    ].map(({ val, label, color }) => (
                      <div key={label} style={{ textAlign: 'center' }}>
                        <b style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 26, display: 'block', lineHeight: 1, color }}>{val}</b>
                        <div style={{ fontSize: 11, color: '#7e8fae', marginTop: 3, whiteSpace: 'nowrap' }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Market readiness ── */}
                <div style={{ marginBottom: 22 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10.5, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--mut-2)', marginBottom: 10 }}>Readiness by market</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {answers.markets.map(m => (
                      <MarketCard key={m} market={m} findings={findings} />
                    ))}
                  </div>
                </div>

                {/* ── What needs fixing ── */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 16 }}>{filter === 'pass' ? 'Checks passing' : filter === 'unverified' ? 'Unverified checks' : 'What needs fixing'}</span>
                    {filter === 'action' && <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: actionFindings.length > 0 ? 'var(--crit)' : 'var(--good)', background: actionFindings.length > 0 ? 'var(--crit-bg)' : 'var(--good-bg)', border: `1px solid ${actionFindings.length > 0 ? '#efc8be' : '#b8dac8'}`, borderRadius: 6, padding: '2px 8px' }}>{actionFindings.length} item{actionFindings.length !== 1 ? 's' : ''}</span>}
                    {filter === 'unverified' && <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: 'var(--mut)', background: '#eef0f4', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px' }}>{unverifiedFindings.length} item{unverifiedFindings.length !== 1 ? 's' : ''}</span>}
                    {filter === 'pass' && <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: 'var(--good)', background: 'var(--good-bg)', border: '1px solid #b8dac8', borderRadius: 6, padding: '2px 8px' }}>{passFindings.length} check{passFindings.length !== 1 ? 's' : ''}</span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      {[['all','All findings'], ['action',`Needs action (${actionFindings.length})`], ['unverified', `Unverified (${unverified})`], ['pass', `Passed (${passes})`], ['fix','Fix now only']].map(([k, lab]) => (
                        <button key={k} onClick={() => setFilter(k)} style={{ border: `1px solid ${filter === k ? (k === 'pass' ? 'var(--good)' : 'var(--ink)') : 'var(--line)'}`, background: filter === k ? (k === 'pass' ? 'var(--good)' : 'var(--ink)') : '#fff', color: filter === k ? '#fff' : 'var(--mut)', borderRadius: 7, padding: '5px 11px', fontSize: 12, cursor: 'pointer', fontWeight: 500, fontFamily: 'Inter' }}>{lab}</button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filteredFindings.length === 0
                      ? <div style={{ background: 'var(--good-bg)', border: '1px solid #b8dac8', borderRadius: 12, padding: '20px 22px', color: 'var(--good)', fontSize: 14, fontWeight: 500 }}>✓ No issues found in this view.</div>
                      : filteredFindings.map((f, i) => <FindingCard key={`${f.checkId}-${i}`} finding={f} selectedMarkets={answers.markets} />)
                    }
                  </div>
                </div>

                {/* ── Passing checks (collapsed) ── */}
                {passFindings.length > 0 && !['pass', 'all'].includes(filter) && (
                  <details style={{ marginTop: 18, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--card)', overflow: 'hidden' }}>
                    <summary style={{ cursor: 'pointer', padding: '13px 18px', fontSize: 13.5, fontWeight: 600, color: 'var(--good)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#1F8A5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {passFindings.length} checks passing
                      <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono'", fontSize: 10, color: 'var(--mut-2)' }}>expand ▾</span>
                    </summary>
                    <div style={{ padding: '2px 18px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {passFindings.map((f, i) => (
                        <PassFindingRow key={i} finding={f} index={i} selectedMarkets={answers.markets} />
                      ))}
                    </div>
                  </details>
                )}

                {/* ── Not applicable (qualified out) ── */}
                {qualifiedOut.length > 0 && (
                  <details style={{ marginTop: 12, border: '1px dashed var(--line)', borderRadius: 12, background: '#f8f9fb', overflow: 'hidden' }}>
                    <summary style={{ cursor: 'pointer', padding: '13px 18px', fontSize: 13, fontWeight: 600, color: 'var(--mut)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, background: '#eef0f4', color: 'var(--mut-2)', border: '1px solid var(--line)', borderRadius: 5, padding: '2px 7px' }}>{qualifiedOut.length}</span>
                      Checks skipped — don't apply based on your answers
                      <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono'", fontSize: 10, color: 'var(--mut-2)' }}>expand ▾</span>
                    </summary>
                    <div style={{ padding: '2px 18px 14px' }}>
                      {qualifiedOut.map((o, i) => (
                        <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderTop: i > 0 ? '1px solid var(--line-2)' : undefined, fontSize: 13 }}>
                          <div style={{ fontWeight: 600, minWidth: 200, color: 'var(--ink)' }}>{o.name}</div>
                          <div style={{ color: 'var(--mut)' }}>{o.why}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* ── Scanner errors ── */}
                {result.errors.length > 0 && (
                  <div style={{ marginTop: 14, background: '#fdf1ec', border: '1px solid #f0d3c8', borderRadius: 12, padding: '13px 18px' }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--high)', marginBottom: 6 }}>Scanner notes</div>
                    {result.errors.map((e, i) => (
                      <p key={i} style={{ fontSize: 12, color: 'var(--high)', fontFamily: "'IBM Plex Mono'" }}>{e.module}/{e.checkId}: {e.message}</p>
                    ))}
                  </div>
                )}

                {/* ── Footer ── */}
                <div style={{ marginTop: 26, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--mut-2)', maxWidth: '52ch', marginRight: 'auto' }}>Results based on automated crawl. Not legal advice — verify requirements with counsel before launch.</div>
                  <button onClick={() => go('intake')} style={{ border: '1px solid var(--line)', background: 'transparent', color: 'var(--mut)', borderRadius: 11, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter' }}>← Edit answers</button>
                  <button
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
                      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${result.domain}-readiness.json` });
                      a.click();
                    }}
                    style={{ border: '1px solid var(--line)', background: 'transparent', color: 'var(--mut)', borderRadius: 11, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter' }}
                  >↓ Export JSON</button>
                  <button onClick={() => { setResult(null); setDomain(''); go('domain'); }} style={{ border: 0, background: 'var(--ink)', color: '#fff', borderRadius: 11, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter' }}>Audit another domain</button>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </>
  );
};

export default Home;
