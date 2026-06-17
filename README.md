# OpenBorder Readiness Scanner

A deterministic crawl-based tool that scans Shopify storefronts for international compliance readiness — legal pages, consent hygiene, localization signals, accessibility violations, and tax display. Returns a scored, prioritized list of findings a merchant must fix before selling into the EU, UK, US, or Canada.

---

## Quick Start

```bash
npm install
cp .env.example .env.local   # add GEMINI_API_KEY (optional — see below)
npm run dev                  # web UI at http://localhost:3000
```

Or run as a CLI:

```bash
npm run analyze gymshark.com
npm run analyze gymshark.com -- --json   # full JSON output
```

---

## What It Does

Type a Shopify domain → get a **0–100 readiness score** plus a prioritized list of findings across five modules:

| Module | What it checks | Severity range |
|--------|---------------|----------------|
| M1 Legal Pages | Privacy, returns, terms, shipping policies; EU withdrawal clause; EU imprint; US opt-out language | 55–92 |
| M2 Consent & Tracking | CMP presence, tracker detection, GDPR privacy link, CCPA opt-out | 50–88 |
| M3 Localization | hreflang tags, country/currency selector, multi-currency support | 25–45 |
| M4 Accessibility | axe-core WCAG violations on homepage + product page (requires Playwright) | 20–85 |
| M5 Tax Display | VAT number in footer, tax-inclusive pricing signal, OSS/VATMOSS | 20–35 |

---

## Features Built

### M1 — Legal Pages Coverage & Content

- **Policy existence checks** — GET `/policies/refund-policy`, `/policies/privacy-policy`, `/policies/terms-of-service`, `/policies/shipping-policy`. HTTP 404 = `fail`. HTTP 200 with < 100 chars of text = `warn` (thin page).
- **EU 14-Day Withdrawal Clause** — checks the refund policy for all four required elements under the EU Consumer Rights Directive (2011/83/EU): 14-day window, right to cancel without reason, who pays return shipping, refund timeline. Uses Gemini (semantic) when `GEMINI_API_KEY` is set; falls back to regex (6 patterns) otherwise. Cites the exact text it based the verdict on.
- **US-State Opt-Out Language** — scans privacy policy for `opt-out`, `do not sell`, `GPC`, `Global Privacy Control`, `your privacy choices`. Warns if absent (CCPA/CPRA obligation for California sellers).
- **EU Legal Imprint (Impressum)** — scans homepage footer for a link to `/pages/impressum` or a VAT/company registration number. Required by German, Austrian, and Swiss commercial law; similar obligations in other EU states.

Severity values match PRD spec: privacy missing = 92, withdrawal clause missing = 88, returns missing = 82, imprint missing = 80, terms missing = 75.

### M2 — Consent & Tracking Hygiene

- **CMP detection** — 9 known signatures: Cookiebot, OneTrust, Didomi, Osano, Termly, iubenda, Usercentrics, CookieYes, Shopify customerPrivacy API.
- **Tracker detection** — 9 known signatures: GA4/gtag, Google Tag Manager, Meta Pixel, TikTok Pixel, Klaviyo, Pinterest Tag, Snapchat Pixel, Hotjar, Segment.
- **Mismatch finding** — trackers detected without any CMP = `fail` severity 88 (GDPR/ePD hard violation).
- **GDPR privacy link** — checks homepage `<a>` tags for a footer privacy link.
- **CCPA opt-out link** — checks homepage for "Do Not Sell or Share" language.

Note: confidence is `medium` — static HTML detection cannot prove scripts fire _before_ consent. This is documented in the evidence field.

### M3 — Localization Surface

- **hreflang tags** — counts `<link rel="alternate" hreflang>` entries; warns if missing or if `x-default` is absent.
- **Shopify localization form** — detects `form[action*="/localization"]`, `country_code` selects, `Shopify.locale` references.
- **Currency selector** — `[data-currency-selector]`, `[class*="currency"]`, `Shopify.currency` references.
- **Multi-currency detection** — parses `presentmentCurrencies` and `Shopify.currency.active` from page JS. Warns if only USD detected.

### M4 — Accessibility Quick Scan

- Launches headless Chromium via Playwright, injects axe-core 4.9.0, runs on homepage + first product page (from `/products.json`).
- Scans a **second product page** if available (stretch goal from PRD §12).
- Maps axe impact levels to severity: critical=85, serious=65, moderate=40, minor=20.
- Skipped automatically on Vercel/Lambda (Playwright unavailable in serverless). Run locally to get results.
- Requires: `npm install playwright && npx playwright install chromium`

### M5 — Tax Display Signal (Stretch)

- **VAT number** — scans footer HTML for EU VAT format patterns (DE/GB/FR/NL etc.), SIRET, BTW, Umsatzsteuer-ID.
- **Tax-inclusive pricing** — looks for "incl. VAT", "excl. VAT", "prices include tax", "+VAT" in page source.
- **OSS/VATMOSS signal** — looks for "One-Stop Shop", "VATMOSS", "digital services VAT" text.

All three are `not_detected` (not `fail`) with `low` confidence — whether this applies depends on merchant jurisdiction, which is an intake-layer decision.

### Scoring

```
penalty_i = severity_i × module_weight × status_multiplier
score = 100 − (total_penalty / max_possible) × 100
```

Module weights: legal_pages=1.0, consent_tracking=0.9, accessibility=0.6, localization=0.5.
Status multipliers: fail=1.0, warn=0.5, pass/not_detected/error=0.0.

### Crawl Harness

- Respects `robots.txt` — checks `isAllowed()` before every request.
- Rate-limited to 400ms between requests.
- Hard cap of 20 requests per audit.
- 10-second timeout per request with one automatic retry.
- Response caching — same URL never fetched twice in one audit.
- Clear `User-Agent`: `OpenBorderCrawler/1.0 (+https://openborder.io/crawler)`.
- `cache: 'no-store'` on all fetch calls so Next.js's fetch cache doesn't interfere.

### LLM Integration (Gemini)

Used in exactly one place: judging the EU withdrawal clause in M1. The LLM:
- Receives only text the crawler already fetched (never a URL to navigate)
- Must cite the exact excerpt it based its verdict on
- Returns structured JSON with `foundElements`, `missingElements`, `citedText`, `reasoning`
- Gracefully returns `null` if `GEMINI_API_KEY` is absent → module falls back to regex

Model: `gemini-2.0-flash` (free tier). Get a key at https://aistudio.google.com/apikey.

---

## How to Run

### Web UI

```bash
npm run dev
# open http://localhost:3000
```

### CLI

```bash
npm run analyze allbirds.com
npm run analyze allbirds.com -- --json
```

### Tests

```bash
npm test          # 40 tests, no network calls, no API key needed
npm run typecheck # TypeScript strict check
```

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | No | Enables LLM withdrawal clause analysis in M1. Without it, regex fallback is used (confidence: medium). |

Copy `.env.example` to `.env.local` and fill in the key.

---

## Known False-Positive Risks

| Check | Risk | Reason |
|-------|------|--------|
| M2 CMP detection | False negative | Custom or in-house CMPs not in the signature list will be missed. Confidence is `medium`. |
| M2 tracker detection | False positive | Trackers loaded via GTM container (not directly in HTML) won't appear in static HTML — they may still fire. |
| M1 withdrawal clause (regex) | False negative | Policies written without standard keywords but legally compliant will be flagged as missing. Use Gemini to reduce this. |
| M3 currency detection | False negative | Shopify Markets configuration doesn't always write `presentmentCurrencies` to page HTML — depends on theme. |
| M5 tax display | High false negative rate | Tax-inclusive pricing is often applied server-side or via geo-IP; static HTML usually shows base prices only. Findings are `not_detected` / `low` confidence, not `fail`. |
| M4 accessibility | Partial coverage | axe-core catches ~30% of WCAG violations automatically. Manual testing still required. |

---

## Architecture

```
Browser / CLI
      ↓
pages/index.tsx (UI)  →  pages/api/analyze.ts (API route)
                                  ↓
                       src/orchestrator.ts — analyze()
                                  ↓
                       src/crawler.ts — Crawler
                       (robots.txt, rate limit, cache, retry)
                                  ↓
              ┌─────────────────────────────────────┐
              │  5 modules run in parallel           │
              │  (Promise.allSettled)                │
              │                                      │
              │  M1 LegalPagesModule                 │
              │    └─ src/llm.ts (Gemini, optional)  │
              │  M2 ConsentTrackingModule             │
              │  M3 LocalizationModule               │
              │  M4 AccessibilityModule (Playwright) │
              │  M5 TaxDisplayModule                 │
              └─────────────────────────────────────┘
                                  ↓
                       src/scoring.ts — computeScore()
                                  ↓
                            AuditResult JSON
```

Adding a new module is mechanical:
1. Create `src/modules/mN.ts` extending `BaseModule`
2. Implement `run(): Promise<Finding[]>`
3. Add to orchestrator's module list
4. Add module weight to `src/config.ts`

---

## Output Shape

```ts
AuditResult {
  domain: string
  platform: "shopify" | "unknown"
  fetchedAt: string          // ISO timestamp
  readinessScore: number     // 0–100
  findings: Finding[]
  errors: ErrorRecord[]
}

Finding {
  module: string             // "legal_pages"
  checkId: string            // "m1_eu_withdrawal"
  title: string              // "EU 14-Day Withdrawal Clause"
  status: "pass" | "warn" | "fail" | "not_detected" | "error"
  severity: number           // 1–100 (meaningful for warn/fail)
  confidence: "high" | "medium" | "low"
  evidence: { url?, selector?, snippet?, value? }
  suggestion: string
  tools?: string[]           // e.g. ["llm:gemini-flash", "axe-core@4.9.0"]
}
```

---

## What I Would Build Next

See [TEN_MORE_HOURS.md](./TEN_MORE_HOURS.md) for a detailed breakdown. Top priorities:

1. **GPSR EU Responsible Person scan** — paginate `/products.json`, flag products missing the EU Responsible Person declaration (hard legal requirement since Dec 2024).
2. **Real-time consent verification** — Playwright network interception to verify trackers actually wait for consent click before firing (closes the biggest M2 false-positive gap).
3. **Shopify Markets GraphQL** — call the Storefront API to enumerate enabled markets, price lists, and currencies with high confidence.
4. **Scheduled re-scan + score history** — Vercel cron + KV store; sparkline of compliance posture over time; alert on score drop.
5. **LLM suggestions for all findings** — wire `enhanceSuggestion()` to every `fail`/`warn` with a Shopify-specific system prompt.

---

## Deployment

See [DEPLOY.md](./DEPLOY.md) for Vercel deployment instructions.

Note: M4 (axe accessibility) is disabled on Vercel — Playwright requires a container runtime. All other modules run serverless.
