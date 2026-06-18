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

const SCAN_LINES = [
  ['Fetching storefront & theme assets', true, '200 OK'],
  ['Mapping Shopify routes /products /cart /policies', true, '42 routes'],
  ['Checking checkout tax display by destination', false, 'tax-excl'],
  ['Scanning for consent platform + GPC handling', false, 'no CMP'],
  ['Detecting currency rendering per region', false, 'USD only'],
  ['Locating legal pages (privacy, terms, returns, imprint)', false, '3 of 4'],
  ['Probing withdrawal / returns flow', false, 'missing'],
  ['Running axe accessibility pass', false, '31 issues'],
  ['Inspecting payment methods at checkout', true, '2 rails'],
  ['Cross-referencing answers vs jurisdiction rules', true, 'done'],
] as [string, boolean, string][];

const DEMO = ['allbirds.com', 'gymshark.com', 'shop.aurora-goods.com'];

// Module → markets for per-market scoring
const MODULE_MARKETS: Record<string, string[]> = {
  legal_pages:      ['EU', 'UK', 'US', 'CA', 'AU'],
  consent_tracking: ['EU', 'UK', 'US'],
  localization:     ['EU', 'UK', 'CA', 'AU'],
  accessibility:    ['EU'],
  tax_display:      ['EU', 'UK'],
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function isFixNow(f: Finding): boolean {
  return f.status === 'fail' && f.severity >= 80;
}

function displayStatus(f: Finding): 'issue' | 'attention' | 'ok' {
  if (f.status === 'fail') return 'issue';
  if (f.status === 'warn' || f.status === 'not_detected') return 'attention';
  return 'ok';
}

function scColor(s: number): string {
  return s >= 80 ? 'var(--good)' : s >= 60 ? 'var(--seal)' : 'var(--crit)';
}

function computeMarketScore(findings: Finding[], market: string): number {
  const rel = findings.filter(f => {
    const mks = MODULE_MARKETS[f.module] ?? ['EU','UK','US','CA','AU'];
    return mks.includes(market) && ['pass','warn','fail'].includes(f.status);
  });
  if (!rel.length) return 85;
  let pen = 0;
  rel.forEach(f => {
    if (f.status === 'fail') pen += f.severity * 0.18;
    else if (f.status === 'warn') pen += f.severity * 0.06;
  });
  return Math.max(25, Math.min(100, Math.round(100 - pen)));
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

function SevBadge({ sev }: { sev: number }) {
  const configs: Record<string, { bg: string; border: string; color: string; label: string }> = {
    crit: { bg: 'var(--crit-bg)', border: '#f0cfc7', color: 'var(--crit)', label: 'critical' },
    high: { bg: 'var(--high-bg)', border: '#f0dec2', color: 'var(--high)', label: 'high' },
    med:  { bg: 'var(--med-bg)',  border: '#ece3bd', color: 'var(--med)',  label: 'medium' },
    low:  { bg: 'var(--low-bg)',  border: '#d6e2da', color: 'var(--low)',  label: 'low' },
  };
  const band = sev >= 80 ? 'crit' : sev >= 65 ? 'high' : sev >= 45 ? 'med' : 'low';
  const c = configs[band];
  return (
    <div style={{ width: 54, flexShrink: 0, textAlign: 'center', borderRadius: 9, padding: '8px 0', border: `1px solid ${c.border}`, background: c.bg, color: c.color }}>
      <b style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 20, display: 'block', lineHeight: 1 }}>{sev}</b>
      <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 8.5, letterSpacing: '.8px', textTransform: 'uppercase', display: 'block', marginTop: 3, opacity: .85 }}>{c.label}</span>
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const fixNow = isFixNow(finding);
  const ds = displayStatus(finding);

  const pillConfigs: Record<string, { bg: string; color: string }> = {
    issue:     { bg: 'var(--crit-bg)', color: 'var(--crit)' },
    attention: { bg: 'var(--high-bg)', color: 'var(--high)' },
    ok:        { bg: 'var(--good-bg)', color: 'var(--good)' },
  };
  const pill = pillConfigs[fixNow ? 'issue' : ds] ?? pillConfigs.ok;
  const pillLabel = fixNow ? 'fix now' : ds;

  return (
    <div
      onClick={() => setOpen(v => !v)}
      style={{
        background: 'var(--card)',
        border: `1px solid ${fixNow ? '#eccabc' : 'var(--line)'}`,
        borderRadius: 12, padding: '16px 18px', display: 'flex', gap: 16, alignItems: 'flex-start',
        boxShadow: fixNow ? '0 1px 2px rgba(194,64,47,.08)' : '0 1px 2px rgba(14,22,38,.04)',
        cursor: 'pointer',
      }}
    >
      <SevBadge sev={finding.severity} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14.5 }}>{finding.title}</span>
          <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, letterSpacing: '.4px', borderRadius: 5, padding: '2px 7px', textTransform: 'uppercase', fontWeight: 500, background: pill.bg, color: pill.color }}>{pillLabel}</span>
          <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10.5, color: 'var(--mut-2)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--good)', display: 'inline-block' }} />
            Detected on site
          </span>
        </div>
        {finding.suggestion && (
          <div style={{ fontSize: 13, color: '#43506a', marginTop: 7 }}>{finding.suggestion}</div>
        )}
        {open && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
            {(finding.evidence?.url || finding.evidence?.value || finding.evidence?.snippet) && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--mut-2)', marginBottom: 6 }}>Evidence</div>
                {finding.evidence.url && <code style={{ fontSize: 11.5, background: '#f3f5f9', border: '1px solid var(--line-2)', borderRadius: 6, padding: '2px 8px', color: '#43506a', display: 'block', width: 'fit-content' }}>{finding.evidence.url}</code>}
                {finding.evidence.value && <p style={{ fontSize: 12, color: 'var(--mut)', marginTop: 4 }}>{finding.evidence.value}</p>}
                {finding.evidence.snippet && <pre style={{ fontSize: 11.5, background: '#f3f5f9', border: '1px solid var(--line-2)', borderRadius: 6, padding: 8, color: 'var(--mut)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 4 }}>{finding.evidence.snippet}</pre>}
              </div>
            )}
            {finding.confidence !== 'high' && (
              <p style={{ fontSize: 11, color: 'var(--mut-2)', fontStyle: 'italic', marginBottom: 6 }}>Confidence: {finding.confidence}</p>
            )}
            {finding.tools && finding.tools.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--mut-2)', marginRight: 2 }}>Tools</span>
                {finding.tools.map(t => (
                  <span key={t} style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: 'var(--mut)', background: '#f3f5f9', border: '1px solid var(--line-2)', borderRadius: 6, padding: '2px 8px' }}>{t}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <span style={{ color: 'var(--mut-2)', fontSize: 11, flexShrink: 0, alignSelf: 'center', marginTop: 2 }}>{open ? '▲' : '▼'}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
const Home: NextPage = () => {
  const [step, setStep]       = useState<Step>('domain');
  const [domain, setDomain]   = useState('');
  const [answers, setAnswers] = useState<IntakeAnswers>({ ...DEFAULT_ANSWERS });
  const [result, setResult]   = useState<AuditResult | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [visibleLines, setVisibleLines] = useState<number[]>([]);
  const [filter, setFilter]   = useState('all');
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
    setVisibleLines([]);
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

    // Animate scan lines
    SCAN_LINES.forEach((_, i) => {
      setTimeout(() => {
        setVisibleLines(prev => [...prev, i]);
        setScanProgress(Math.round((i + 1) / SCAN_LINES.length * 100));
      }, i * 380 + 100);
    });

    // Animation done — wait for API if needed
    setTimeout(() => {
      animDoneRef.current = true;
      if (apiDoneRef.current) finalize();
    }, SCAN_LINES.length * 380 + 600);
  }

  function finalize() {
    if (apiDataRef.current) {
      setResult(apiDataRef.current);
      setFilter('all');
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
  const fixNows    = findings.filter(isFixNow);
  const score      = result?.readinessScore ?? 0;

  const verdict = score >= 80
    ? { h: 'Cleared to scale',    p: 'Minor polish only — no launch blockers detected.' }
    : score >= 60
    ? { h: 'Conditional',         p: 'Launchable after the fix-now items are closed.' }
    : { h: 'Not launch-ready',    p: 'Hard blockers open in one or more target markets.' };

  const filteredFindings = findings.filter(f => {
    if (filter === 'fix')       return isFixNow(f);
    if (filter === 'issue')     return f.status === 'fail';
    if (filter === 'attention') return f.status === 'warn' || f.status === 'not_detected';
    if (filter === 'clear')     return f.status === 'pass';
    return f.status !== 'error';
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
                  {[['25','readiness checks'],['5','jurisdictions covered'],['1–100','severity per finding']].map(([b, label]) => (
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
                {SCAN_LINES.map(([text, isDone, status], i) => {
                  const vis = visibleLines.includes(i);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: "'IBM Plex Mono'", fontSize: 13, padding: '9px 0', borderBottom: '1px solid #1c2a44', opacity: vis ? 1 : 0, transform: vis ? 'none' : 'translateX(-6px)', transition: 'opacity .3s, transform .3s' }}>
                      <span style={{ width: 18, height: 18, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, background: !vis ? '#1d2c47' : isDone ? 'rgba(31,138,91,.2)' : 'rgba(217,145,43,.22)', color: !vis ? '#7e90b0' : isDone ? '#5fd39d' : '#e9b15a' }}>
                        {vis ? (isDone ? '✓' : '⚠') : '›'}
                      </span>
                      <span style={{ color: '#c3d0e6' }}>{text}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: !vis ? '#6b7d9d' : isDone ? '#5fd39d' : '#e9b15a' }}>{status}</span>
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
                <div style={{ marginBottom: 26 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--seal)', fontWeight: 500 }}>Step 3 · Findings for <span style={{ fontFamily: "'IBM Plex Mono'" }}>{domain}</span></div>
                  <h2 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 26, letterSpacing: '-.3px', marginTop: 8 }}>Launch readiness report</h2>
                </div>

                {/* Summary grid */}
                <div className="summary-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,300px) 1fr', gap: 18, marginBottom: 20 }}>
                  {/* Score box */}
                  <div style={{ background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: 24, display: 'flex', gap: 20, alignItems: 'center', boxShadow: '0 1px 2px rgba(14,22,38,.05),0 8px 24px rgba(14,22,38,.06)' }}>
                    <ScoreRing score={score} />
                    <div>
                      <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--seal)' }}>Verdict</div>
                      <h3 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 18, margin: '6px 0 4px' }}>{verdict.h}</h3>
                      <p style={{ fontSize: 12.5, color: '#aab9d4', maxWidth: '24ch' }}>{verdict.p}</p>
                    </div>
                  </div>

                  {/* Stats + markets panel */}
                  <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(14,22,38,.05),0 8px 24px rgba(14,22,38,.06)' }}>
                    <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 16 }}>
                      {[
                        { val: fixNows.length, label: 'Fix right away', color: 'var(--crit)' },
                        { val: fails,           label: 'Open issues',    color: 'var(--high)' },
                        { val: warns,           label: 'Needs attention', color: 'var(--med)' },
                        { val: passes,          label: 'Clear',          color: 'var(--good)' },
                      ].map(({ val, label, color }) => (
                        <div key={label} style={{ minWidth: 78 }}>
                          <b style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 24, display: 'block', lineHeight: 1, color }}>{val}</b>
                          <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 3 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10.5, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--mut-2)', marginBottom: 9 }}>Readiness by jurisdiction</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {answers.markets.map(m => {
                        const s = computeMarketScore(findings, m);
                        return (
                          <div key={m} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '7px 11px', display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: scColor(s), display: 'inline-block' }} />
                            <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: 'var(--mut)', letterSpacing: 1 }}>{m}</span>
                            <span style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 15, color: scColor(s) }}>{s}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Fix right away block */}
                {fixNows.length > 0 && (
                  <div style={{ border: '1px solid #f0d3c8', background: 'linear-gradient(180deg,#fdf1ec,#fff)', borderRadius: 14, padding: '18px 20px', marginBottom: 22, boxShadow: '0 1px 2px rgba(14,22,38,.05),0 8px 24px rgba(14,22,38,.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 15, color: 'var(--crit)', marginBottom: 14 }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5 14.5 13H1.5L8 1.5Z" stroke="#C2402F" strokeWidth="1.4" strokeLinejoin="round"/><path d="M8 6v3.2M8 11.2h.01" stroke="#C2402F" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      Fix right away · {fixNows.length} item{fixNows.length > 1 ? 's' : ''}
                      <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono'", fontSize: 10, letterSpacing: 1, color: '#b06a52', background: '#fbe6de', border: '1px solid #f0d0c4', borderRadius: 6, padding: '3px 8px', textTransform: 'uppercase' }}>blockers</span>
                    </div>
                    {fixNows.map((f, i) => (
                      <div key={f.checkId} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '11px 0', borderTop: i > 0 ? '1px dashed #f0d8cf' : undefined }}>
                        <SevBadge sev={f.severity} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{f.title}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 2 }}>{f.suggestion}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Filter toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '6px 0 14px' }}>
                  <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--mut-2)', marginRight: 6 }}>Findings</span>
                  {[
                    ['all',       'All',       findings.filter(f => f.status !== 'error').length],
                    ['fix',       'Fix now',   fixNows.length],
                    ['issue',     'Issues',    fails],
                    ['attention', 'Attention', warns + notDet],
                    ['clear',     'Clear',     passes],
                  ].map(([k, lab, count]) => (
                    <button key={k} onClick={() => setFilter(k as string)} style={{ border: `1px solid ${filter === k ? 'var(--ink)' : 'var(--line)'}`, background: filter === k ? 'var(--ink)' : '#fff', color: filter === k ? '#fff' : 'var(--mut)', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', fontWeight: 500, fontFamily: 'Inter' }}>
                      {lab}<span style={{ fontFamily: "'IBM Plex Mono'", opacity: .7, marginLeft: 5 }}>{count}</span>
                    </button>
                  ))}
                </div>

                {/* Findings list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filteredFindings.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--mut)', padding: 30, fontSize: 14 }}>Nothing in this filter.</div>
                  )}
                  {filteredFindings.map((f, i) => <FindingRow key={`${f.checkId}-${i}`} finding={f} />)}
                </div>

                {/* Qualified out */}
                {qualifiedOut.length > 0 && (
                  <details style={{ marginTop: 24, border: '1px dashed var(--line)', borderRadius: 12, background: '#f5f7fa', overflow: 'hidden' }}>
                    <summary style={{ cursor: 'pointer', padding: '14px 18px', fontSize: 13.5, fontWeight: 600, color: 'var(--mut)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>▸</span> Qualified out by your answers ({qualifiedOut.length})
                    </summary>
                    <div style={{ padding: '2px 18px 16px' }}>
                      {qualifiedOut.map((o, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: i > 0 ? '1px solid var(--line-2)' : undefined, fontSize: 13 }}>
                          <div style={{ fontWeight: 600, minWidth: 220, color: 'var(--ink)' }}>{o.name}</div>
                          <div style={{ color: 'var(--mut)' }}>{o.why}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Scanner errors (module-level failures) */}
                {result.errors.length > 0 && (
                  <div style={{ marginTop: 16, background: '#fdf1ec', border: '1px solid #f0d3c8', borderRadius: 12, padding: '14px 18px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--high)', marginBottom: 8 }}>Scanner notes</div>
                    {result.errors.map((e, i) => (
                      <p key={i} style={{ fontSize: 12, color: 'var(--high)', fontFamily: "'IBM Plex Mono'" }}>{e.module}/{e.checkId}: {e.message}</p>
                    ))}
                  </div>
                )}

                {/* Footer */}
                <div style={{ marginTop: 26, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--mut-2)', maxWidth: '52ch', marginRight: 'auto' }}>Results based on automated crawl. Severity blends legal weight, enforcement, and detected gap. Not legal advice — confirm per category with counsel.</div>
                  <button onClick={() => go('intake')} style={{ border: '1px solid var(--line)', background: 'transparent', color: 'var(--mut)', borderRadius: 11, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter' }}>← Edit answers</button>
                  <button
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
                      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${result.domain}-readiness.json` });
                      a.click();
                    }}
                    style={{ border: '1px solid var(--line)', background: 'transparent', color: 'var(--mut)', borderRadius: 11, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter' }}
                  >
                    ↓ Export JSON
                  </button>
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
