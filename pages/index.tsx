import React, { useState } from 'react';
import type { NextPage } from 'next';
import Head from 'next/head';
import type { AuditResult, Finding } from '../src/types';

const STATUS_CONFIG = {
  pass:         { label: 'Pass',      bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', icon: '✓' },
  warn:         { label: 'Warn',      bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-500',   icon: '!' },
  fail:         { label: 'Fail',      bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200',     dot: 'bg-red-500',     icon: '✗' },
  not_detected: { label: 'Not Found', bg: 'bg-slate-50',    text: 'text-slate-500',   border: 'border-slate-200',   dot: 'bg-slate-400',   icon: '○' },
  error:        { label: 'Error',     bg: 'bg-orange-50',   text: 'text-orange-700',  border: 'border-orange-200',  dot: 'bg-orange-400',  icon: '⚠' },
} as const;

const MODULE_META: Record<string, { label: string; icon: string }> = {
  legal_pages:      { label: 'M1 Legal Pages',        icon: '⚖️' },
  consent_tracking: { label: 'M2 Consent & Tracking',  icon: '🍪' },
  localization:     { label: 'M3 Localization',        icon: '🌍' },
  accessibility:    { label: 'M4 Accessibility',       icon: '♿' },
  tax_display:      { label: 'M5 Tax Display',         icon: '💶' },
};

function getScoreMeta(score: number) {
  if (score >= 80) return { color: '#10b981', track: '#d1fae5', label: 'Good',      sub: 'Ready for international sales' };
  if (score >= 60) return { color: '#f59e0b', track: '#fef3c7', label: 'Needs Work', sub: 'Address key issues before launch' };
  if (score >= 40) return { color: '#f97316', track: '#ffedd5', label: 'At Risk',    sub: 'Significant compliance gaps' };
  return             { color: '#ef4444', track: '#fee2e2', label: 'Critical',    sub: 'Not ready for international sales' };
}

function ScoreRing({ score }: { score: number }) {
  const meta = getScoreMeta(score);
  const r = 52;
  const circ = 2 * Math.PI * r;
  const fill = (Math.max(0, Math.min(100, score)) / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <svg width="136" height="136" className="-rotate-90">
          <circle cx="68" cy="68" r={r} fill="none" stroke={meta.track} strokeWidth="10" />
          <circle
            cx="68" cy="68" r={r}
            fill="none"
            stroke={meta.color}
            strokeWidth="10"
            strokeDasharray={`${fill} ${circ}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold text-slate-800">{Math.round(score)}</span>
          <span className="text-xs text-slate-400">/100</span>
        </div>
      </div>
      <div className="text-center">
        <div className="font-semibold text-sm" style={{ color: meta.color }}>{meta.label}</div>
        <div className="text-xs text-slate-400 mt-0.5">{meta.sub}</div>
      </div>
    </div>
  );
}

function SeverityBar({ severity }: { severity: number }) {
  if (!severity) return <span className="text-slate-300 text-xs font-mono">—</span>;
  const color = severity >= 80 ? '#ef4444' : severity >= 60 ? '#f59e0b' : severity >= 40 ? '#f97316' : '#94a3b8';
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${severity}%`, background: color }} />
      </div>
      <span className="text-xs text-slate-500 tabular-nums w-5">{severity}</span>
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[finding.status];
  const mod = MODULE_META[finding.module];

  return (
    <div
      className={`border ${cfg.border} rounded-xl overflow-hidden cursor-pointer transition-shadow hover:shadow-sm`}
      onClick={() => setOpen(v => !v)}
    >
      {/* Row */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 ${cfg.dot}`}>
          {cfg.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-slate-800 truncate">{finding.title}</div>
          <div className="text-xs text-slate-400 mt-0.5">{mod?.icon} {mod?.label ?? finding.module}</div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <SeverityBar severity={finding.severity} />
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${cfg.border} ${cfg.text} ${cfg.bg} min-w-[68px] text-center`}>
            {cfg.label}
          </span>
          <span className="text-slate-300 text-xs w-3">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded */}
      {open && (
        <div className={`${cfg.bg} border-t ${cfg.border} px-4 py-3 space-y-3`}>
          {finding.suggestion && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Recommendation</p>
              <p className="text-sm text-slate-700 leading-relaxed">{finding.suggestion}</p>
            </div>
          )}
          {(finding.evidence?.url || finding.evidence?.value || finding.evidence?.snippet) && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Evidence</p>
              <div className="space-y-1">
                {finding.evidence.url && (
                  <code className="text-xs bg-white/80 border border-slate-200 rounded px-2 py-0.5 text-slate-600 block w-fit">
                    {finding.evidence.url}
                  </code>
                )}
                {finding.evidence.value && (
                  <p className="text-xs text-slate-500">{finding.evidence.value}</p>
                )}
                {finding.evidence.snippet && (
                  <pre className="text-xs bg-white/80 border border-slate-200 rounded p-2 text-slate-500 whitespace-pre-wrap break-all line-clamp-3">
                    {finding.evidence.snippet}
                  </pre>
                )}
              </div>
            </div>
          )}
          {finding.confidence !== 'high' && (
            <p className="text-[11px] text-slate-400 italic">Confidence: {finding.confidence}</p>
          )}
          {finding.tools?.length ? (
            <div className="flex gap-1.5 flex-wrap">
              {finding.tools.map(t => (
                <span key={t} className="text-[11px] bg-violet-50 text-violet-600 border border-violet-200 rounded-full px-2 py-0.5">{t}</span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ModuleGroup({ moduleId, findings }: { moduleId: string; findings: Finding[] }) {
  const mod = MODULE_META[moduleId];
  const fails  = findings.filter(f => f.status === 'fail').length;
  const warns  = findings.filter(f => f.status === 'warn').length;
  const passes = findings.filter(f => f.status === 'pass').length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span>{mod?.icon ?? '📋'}</span>
        <h3 className="font-semibold text-sm text-slate-700">{mod?.label ?? moduleId}</h3>
        <div className="flex gap-1.5 ml-auto">
          {fails  > 0 && <span className="text-[11px] font-medium bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5">{fails} fail</span>}
          {warns  > 0 && <span className="text-[11px] font-medium bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-2 py-0.5">{warns} warn</span>}
          {passes > 0 && <span className="text-[11px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full px-2 py-0.5">{passes} pass</span>}
        </div>
      </div>
      <div className="space-y-2">
        {findings.map((f, i) => <FindingCard key={`${f.checkId}-${i}`} finding={f} />)}
      </div>
    </div>
  );
}

const DEMO = ['allbirds.com', 'gymshark.com', 'kylieskinshopping.com'];
const MODULE_ORDER = ['legal_pages', 'consent_tracking', 'localization', 'accessibility', 'tax_display'];

const Home: NextPage = () => {
  const [domain, setDomain]   = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<AuditResult | null>(null);
  const [error, setError]     = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!clean) return;
    setLoading(true); setResult(null); setError(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: clean }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setResult(await res.json() as AuditResult);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const fails  = result?.findings.filter(f => f.status === 'fail').length ?? 0;
  const warns  = result?.findings.filter(f => f.status === 'warn').length ?? 0;
  const passes = result?.findings.filter(f => f.status === 'pass').length ?? 0;
  const groups = MODULE_ORDER
    .map(id => ({ id, findings: result?.findings.filter(f => f.module === id) ?? [] }))
    .filter(g => g.findings.length > 0);

  return (
    <>
      <Head>
        <title>OpenBorder — International Readiness Scanner</title>
        <meta name="description" content="Scan your Shopify store for international compliance issues." />
      </Head>

      <div className="min-h-screen bg-slate-50">
        {/* Nav */}
        <nav className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center gap-3 sticky top-0 z-10">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-xs font-bold text-white">OB</div>
          <span className="font-bold text-slate-800 tracking-tight">OpenBorder</span>
          <span className="text-slate-300 text-sm">·</span>
          <span className="text-sm text-slate-400">International Readiness Scanner</span>
          {result && (
            <button
              onClick={() => { setResult(null); setDomain(''); }}
              className="ml-auto text-sm text-slate-400 hover:text-slate-700 transition-colors"
            >
              ← New scan
            </button>
          )}
        </nav>

        <main className="max-w-3xl mx-auto px-4 py-10">
          {/* Hero (only pre-scan) */}
          {!result && !loading && (
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-full px-4 py-1.5 text-xs text-violet-600 font-medium mb-5">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                EU compliance deadlines · mid-2026
              </div>
              <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
                Is your Shopify store<br />ready to go global?
              </h1>
              <p className="text-slate-500 text-base max-w-md mx-auto">
                Scan for EU, UK, and US compliance gaps in 30 seconds — legal pages, GDPR consent, localization, accessibility, and tax display.
              </p>
            </div>
          )}

          {/* Search bar */}
          <form onSubmit={handleSubmit} className="mb-6">
            <div className="flex gap-2 bg-white border border-slate-200 shadow-sm rounded-2xl p-1.5 focus-within:ring-2 focus-within:ring-violet-500/30 focus-within:border-violet-400 transition-all">
              <input
                type="text"
                value={domain}
                onChange={e => setDomain(e.target.value)}
                placeholder="Enter a Shopify domain, e.g. allbirds.com"
                className="flex-1 px-3 py-2.5 text-slate-800 placeholder-slate-300 text-sm focus:outline-none bg-transparent"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !domain.trim()}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-sm font-semibold hover:from-violet-700 hover:to-blue-700 disabled:opacity-40 transition-all shadow-sm"
              >
                {loading
                  ? <span className="flex items-center gap-2"><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Scanning…</span>
                  : 'Scan →'}
              </button>
            </div>

            {!result && !loading && (
              <div className="flex items-center justify-center gap-2 mt-3">
                <span className="text-xs text-slate-400">Try:</span>
                {DEMO.map(d => (
                  <button key={d} type="button" onClick={() => setDomain(d)}
                    className="text-xs text-slate-500 hover:text-violet-600 border border-slate-200 hover:border-violet-300 rounded-full px-3 py-1 transition-colors bg-white">
                    {d}
                  </button>
                ))}
              </div>
            )}
          </form>

          {/* Error banner */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-6 text-sm">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-center py-20">
              <div className="relative w-14 h-14 mx-auto mb-5">
                <div className="absolute inset-0 rounded-full border-4 border-violet-100" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-violet-600 animate-spin" />
              </div>
              <p className="text-slate-500 text-sm">Crawling storefront…</p>
              <p className="text-slate-400 text-xs mt-1">Checking policies, trackers, hreflang, and more</p>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-5">
              {/* Score card */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 flex flex-col sm:flex-row items-center gap-8">
                <ScoreRing score={result.readinessScore} />
                <div className="flex-1 w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-xl font-bold text-slate-800">{result.domain}</h2>
                    <span className="text-xs bg-violet-50 text-violet-600 border border-violet-200 rounded-full px-2 py-0.5 font-medium">{result.platform}</span>
                  </div>
                  <p className="text-xs text-slate-400 mb-5">Scanned {new Date(result.fetchedAt).toLocaleString()}</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { count: fails,  label: 'Fails',   bg: 'bg-red-50',     text: 'text-red-600',     border: 'border-red-100' },
                      { count: warns,  label: 'Warns',   bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-100' },
                      { count: passes, label: 'Passing', bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' },
                    ].map(s => (
                      <div key={s.label} className={`${s.bg} ${s.border} border rounded-xl py-3 text-center`}>
                        <div className={`text-2xl font-bold ${s.text}`}>{s.count}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
                    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${result.domain}-readiness.json` });
                    a.click();
                  }}
                  className="flex-shrink-0 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 border border-slate-200 hover:border-slate-400 rounded-xl px-4 py-2.5 transition-colors"
                >
                  ↓ JSON
                </button>
              </div>

              {/* Module groups */}
              {groups.map(({ id, findings }) => (
                <div key={id} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                  <ModuleGroup moduleId={id} findings={findings} />
                </div>
              ))}

              {/* Module errors */}
              {result.errors.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-orange-700 mb-2">Module Errors</h3>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-orange-600 font-mono">{e.module}/{e.checkId}: {e.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

        <footer className="text-center text-xs text-slate-300 py-8 mt-8 border-t border-slate-100">
          OpenBorder · Deterministic crawl · No data stored · M4 accessibility requires CLI + Playwright
        </footer>
      </div>
    </>
  );
};

export default Home;
