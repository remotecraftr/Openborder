# OpenBorder — Features & Implementation Reference

## Overview

OpenBorder is a read-only automated scanner that crawls a Shopify storefront and scores its international compliance readiness on a 0–100 scale. It runs 5 modules (M1–M5) in parallel, each returning a set of **findings**. Findings are scored, filtered, and displayed in the 3-step wizard UI.

---

## How a Scan Works (End-to-End)

```
User enters domain
       ↓
Step 2: Intake questionnaire (markets, B2B/B2C, product type, etc.)
       ↓
Step 3a: Scan animation plays while API call runs in background
       ↓
POST /api/analyze { domain }
       ↓
Orchestrator:
  1. Checks site is reachable (GET /) — throws if not
  2. Detects Shopify via /meta.json
  3. Runs M1, M2, M3, M4, M5 in parallel (Promise.allSettled)
  4. Computes readiness score from findings
  5. Returns AuditResult JSON
       ↓
Step 3b: Results displayed — findings, score ring, market scores, qualified-out list
```

**Crawler rules**: 400ms rate limit between requests · 20 request cap · 10s timeout · 1 retry · `cache: 'no-store'` to bypass Next.js fetch caching.

---

## Readiness Score

```
score = 100 − (totalPenalty / maxPossible) × 100

Where:
  penalty_i     = severity_i × moduleWeight × statusMultiplier
  maxPossible   = sum of (100 × moduleWeight × 1.0) for all scoreable findings
```

Only `pass`, `warn`, and `fail` findings participate in scoring. `not_detected` and `error` findings are informational only — they don't inflate or deflate the score.

| Status | Multiplier | Effect |
|---|---|---|
| `fail` | 1.0 | Full severity penalty |
| `warn` | 0.5 | Half penalty |
| `pass` | 0.0 | No penalty |
| `not_detected` | 0.0 | No penalty (shown as attention) |
| `error` | 0.0 | No penalty (shown separately) |

| Module | Weight |
|---|---|
| M1 Legal Pages | 1.0 |
| M2 Consent & Tracking | 0.9 |
| M3 Localization | 0.5 |
| M4 Accessibility | 0.6 |
| M5 Tax Display | not weighted (stretch module) |

**Score labels**: ≥80 Good · ≥60 Needs Work · ≥40 At Risk · <40 Critical

---

## M1 — Legal Pages

**File**: `src/modules/m1Legal.ts`  
**Module ID**: `legal_pages`  
**Weight**: 1.0 (highest)

Checks that all mandatory legal pages exist and contain meaningful content. Also performs deep analysis of the withdrawal clause and privacy opt-out language using LLM or regex fallback.

### Checks

#### 1. Policy Page Existence (4 checks)

For each of 4 policy URLs, the crawler fetches the page and evaluates:

| Check | Path | Severity | Pass | Fail | Warn |
|---|---|---|---|---|---|
| Refund / Returns Policy | `/policies/refund-policy` | 82 | 200 OK + content ≥100 chars | HTTP 4xx/5xx | content <100 chars |
| Privacy Policy | `/policies/privacy-policy` | 92 | 200 OK + content ≥100 chars | HTTP 4xx/5xx | content <100 chars |
| Terms of Service | `/policies/terms-of-service` | 75 | 200 OK + content ≥100 chars | HTTP 4xx/5xx | content <100 chars |
| Shipping Policy | `/policies/shipping-policy` | 60 | 200 OK + content ≥100 chars | HTTP 4xx/5xx | content <100 chars |

#### 2. EU 14-Day Withdrawal Clause (`m1_eu_withdrawal`, severity 88)

Only runs if the Refund Policy page passes. Reads the policy text and evaluates it for EU Consumer Rights Directive compliance.

**Primary method — Gemini LLM** (requires `GEMINI_API_KEY`):
- Sends up to 4,000 chars of policy text to `gemini-2.0-flash`
- Checks for all 4 required elements:
  1. 14-day withdrawal period from delivery
  2. Right to cancel without giving a reason
  3. Who bears return shipping cost
  4. Refund timeline (within 14 days of cancellation)
- Returns `pass` if all 4 present; `fail` with specific missing elements if not
- Confidence: `high`

**Fallback — Regex** (when no API key or LLM fails):
- Looks for patterns: `14 days`, `withdrawal`, `Widerruf`, `cooling-off`, `right to cancel`, `Consumer Rights Directive`
- 2+ matches → `pass` (confidence: medium)
- 1 match → `warn` severity 50
- 0 matches → `fail` severity 88

#### 3. US-State Privacy Opt-Out (`m1_us_opt_out`, severity 55)

Reads the Privacy Policy page text and looks for CCPA/CPRA opt-out signals:
- Patterns: `opt-out`, `do not sell`, `GPC`, `global privacy control`, `your privacy rights/choices`, `right to opt-out`
- Pass → language present
- Warn → none detected (California CCPA/CPRA requirement if selling to US residents)

#### 4. EU Legal Imprint / Impressum (`m1_eu_imprint`, severity 80)

Fetches the homepage (`/`) and checks:
- Any `<a>` tag with `href` or text containing "impressum"
- Footer text matching VAT ID formats: `DE123456789`, `vat no: ...`, `Umsatzsteuer-ID`, `BTW-nummer`, `SIRET/SIREN`

Pass → imprint link or VAT ID found  
Not_detected → neither found (required by German §5 DDG and equivalent EU laws)

---

## M2 — Consent & Tracking

**File**: `src/modules/m2Consent.ts`  
**Module ID**: `consent_tracking`  
**Weight**: 0.9

Checks the homepage HTML source for known Consent Management Platforms, tracking scripts that fire without consent, and required legal links.

### Checks

#### 1. Consent Management Platform (`m2_cmp_present`, severity 75)

Scans HTML for signatures of 9 known CMPs:

| CMP | Detection Pattern |
|---|---|
| Cookiebot | `cookiebot.com` or `CookieConsent` |
| OneTrust | `onetrust`, `optanon`, `cookielaw.org` |
| Didomi | `didomi.io` or `didomiOnReady` |
| Osano | `osano.com` |
| Termly | `termly.io` |
| iubenda | `iubenda.com` |
| Usercentrics | `usercentrics.eu` or `.com` |
| Shopify customerPrivacy | `customerPrivacy` or `Shopify.customerPrivacy` |
| CookieYes | `cookieyes.com` or `cky-consent` |

- **Pass** — known CMP found
- **Warn** — no known CMP but generic consent markup detected (`cookie consent`, `gdpr`, `data-consent`, etc.)
- **Not_detected** — nothing found (severity 75; required for EU/UK advertising)

#### 2. Trackers Without Consent Gate (per tracker, severity 88)

Scans HTML for 9 common tracking scripts:

| Tracker | Detection |
|---|---|
| Google Analytics 4 | `gtag(`, `googletagmanager.com/gtag`, `G-XXXXXXXX` |
| Google Tag Manager | `googletagmanager.com/gtm`, `GTM-XXXXXX` |
| Meta Pixel | `connect.facebook.net + fbevents`, `fbq(` |
| TikTok Pixel | `analytics.tiktok.com`, `ttq.` |
| Klaviyo | `klaviyo.com`, `_learnq.` |
| Pinterest Tag | `pintrk(`, `ct.pinterest.com` |
| Snapchat Pixel | `sc-static.net`, `snaptr(` |
| Hotjar | `hotjar.com`, `hjid:` |
| Segment | `segment.io`, `cdn.segment.com` |

**If a CMP is also found**: trackers → `pass` (assumed gated by the CMP)  
**If no CMP**: each tracker → `fail` severity 88 (GDPR requires pre-consent blocking)

#### 3. Privacy Policy Link in Footer (`m2_privacy_link`, severity 55)

Checks all `<a>` tags on the homepage for:
- `href` containing `privacy`
- link text containing `privacy` or `datenschutz`

Pass → link found  
Not_detected → no link (GDPR Art. 13 requires easy access)

#### 4. CCPA "Do Not Sell or Share" Link (`m2_ccpa_opt_out`, severity 50)

Scans full page HTML for California privacy opt-out patterns:
- `do not sell or share my personal information`
- `do not sell or share`
- `opt-out of sale/selling`
- `your privacy choices`
- `california privacy rights`

Pass → found  
Not_detected → not found (required if sharing data with third parties for California residents)

---

## M3 — Localization

**File**: `src/modules/m3Locale.ts`  
**Module ID**: `localization`  
**Weight**: 0.5

Checks the homepage for international routing and multi-currency signals.

### Checks

#### 1. hreflang Tags (`m3_hreflang`, severity 45)

Reads all `<link rel="alternate" hreflang="...">` tags in `<head>`:
- **Pass** — tags exist AND include `x-default`
- **Warn** severity 30 — tags exist but no `x-default` fallback
- **Not_detected** severity 45 — no hreflang tags at all

Reports all detected locales (e.g. `en-GB, fr-FR, x-default`).

#### 2. Shopify Localization Form / Country Selector (`m3_localization_form`, severity 40)

Looks for:
- A `<form>` whose `action` contains `localization`, or inner HTML contains `locale`, `country_code`, or `disclosure`
- A `<select>` with name/id containing `locale` or `country`
- `Shopify.locale` or `localization` in the page JS

Pass → any signal found  
Not_detected → nothing detected (no way for users to switch market/language)

#### 3. Currency Selector (`m3_currency_selector`, severity 35)

Looks for:
- `[data-currency-selector]` element
- Any element with class or id containing `currency`
- JS patterns: `currency-switch`, `currency-select`, `Shopify.currency`

Pass → detected  
Not_detected → not found (users see prices in store default currency only)

#### 4. Multi-Currency Support (`m3_enabled_currencies`, severity 30)

Reads page JS for:
- `presentmentCurrencies` array — lists all currencies enabled via Shopify Markets
- `"currencies": [...]` JSON
- `Shopify.currency = { "active": "XXX" }` — the active currency code

- **Pass** — 2+ currencies in `presentmentCurrencies`
- **Warn** severity 25 — only USD active (no local currency for international shoppers)
- **Not_detected** — no currency data in page source

---

## M4 — Accessibility

**File**: `src/modules/m4Axe.ts`  
**Module ID**: `accessibility`  
**Weight**: 0.6

Runs the axe-core accessibility engine via Playwright Chromium against real product pages.

### Environment Behaviour

| Environment | Behaviour |
|---|---|
| **Vercel / AWS Lambda** | Returns `error` finding — skipped (Playwright can't run in serverless) |
| **Local dev server** (Next.js) | Returns `error` finding — Playwright can't launch inside the Next.js process |
| **CLI** (`npm run analyze <domain>`) | Runs fully — Playwright launches headless Chromium |

### What it scans

1. **Primary URL**: Fetches `/products.json?limit=1`, gets first product handle → scans `https://domain/products/<handle>`
   - Falls back to homepage if no products found
2. **Secondary URL** (best-effort): Fetches second product, scans it too — deduplicates violations by `checkId`

### Detection method

Injects `axe-core@4.9.0` from CDN into the page and calls `axe.run()` after `domcontentloaded`.

### Severity mapping

| axe impact | OpenBorder severity |
|---|---|
| `critical` | 85 |
| `serious` | 65 |
| `moderate` | 40 |
| `minor` | 20 |

- **0 violations** → single `pass` finding
- **N violations** → N `fail` findings, one per axe rule ID (e.g. `m4_axe_color-contrast`, `m4_axe_label`)

Each finding includes the failing element's HTML snippet and CSS selector.

### Note on EU compliance

The European Accessibility Act (EAA) requires WCAG 2.1 AA compliance for stores selling to EU consumers (micro-enterprises with <10 staff and <€2M revenue may be exempt).

---

## M5 — Tax Display

**File**: `src/modules/m5Tax.ts`  
**Module ID**: `tax_display`  
**Weight**: not weighted (stretch module — excluded from score by default)

Static-signal scan of the homepage HTML. Does **not** visit checkout or geo-spoof. Checks for tax compliance signals visible in the page source.

### Checks

#### 1. VAT / Tax Registration Number (`m5_vat_number`, severity 30)

Scans footer HTML and full page source for:
- EU VAT format: `GB123456789`, `DE123456789`
- `vat no: ...`, `tax number: ...`
- `Umsatzsteuer-ID` (German), `BTW-nummer` (Dutch)
- `SIRET` / `SIREN` (French company registration)

Pass → any format found in footer or page source  
Not_detected → not found (EU/UK law requires VAT number display if VAT-registered)

#### 2. Tax-Inclusive Price Display (`m5_tax_inclusive_display`, severity 35)

Looks for phrases like:
- `incl. VAT` / `incl. tax` / `incl. GST` / `incl. MwSt`
- `VAT included` / `prices include VAT`
- `tax inclusive` / `tax included`
- `+ VAT` (signals prices are shown exclusive)

Pass → any tax display language found  
Not_detected → nothing found (EU Price Indication Directive requires consumer prices to include all taxes)

#### 3. EU OSS / VAT-MOSS Registration Signal (`m5_oss_vatmoss`, severity 20)

Scans for mentions of EU tax registration schemes:
- `OSS VAT` / `VAT OSS`
- `One-Stop Shop`
- `VAT-MOSS` / `VAT MOSS`
- `digital services VAT/tax`

Pass → signal found  
Not_detected → not found (informational — required if B2C digital goods or >€10k physical goods to EU)

---

## LLM Integration

**File**: `src/llm.ts`  
**Model**: `gemini-2.0-flash`  
**API key env var**: `GEMINI_API_KEY`

The LLM layer is **optional** — all checks fall back to regex/heuristic detection if the key is absent or the call fails.

### What the LLM does

| Function | Used by | What it does |
|---|---|---|
| `judgeWithdrawalClause(policyText)` | M1 | Reads full returns policy, judges EU withdrawal clause compliance against 4 required elements, returns structured JSON verdict |
| `enhanceSuggestion(title, status, evidence, current)` | Available — not wired by default | Rewrites a finding's suggestion text to be more specific and actionable |

### LLM constraints (per PRD §3)

- Operates **only on text the crawler already fetched** — never navigates to a URL itself
- Must cite evidence used (`citedText` field)
- Truncates policy text to 4,000 chars before sending
- Returns `null` gracefully on any failure (network error, quota, bad JSON)

---

## Intake Questionnaire (Frontend)

The 3-step wizard collects answers before running the scan. These answers are **not sent to the backend** — they are used client-side only for two purposes:

### 1. Qualified Out section

Based on intake answers, checks that don't apply are listed under "Qualified out by your answers". Examples:
- B2B seller → skips withdrawal checks, returns policy, consumer pricing rules
- No EU market selected → skips Impressum, EAA accessibility, GPSR responsible person
- Digital goods only → skips customs/landed-cost handling, CE/UKCA marking
- No email marketing → skips CASL/PECR consent check
- Own store only → skips DSA trader transparency

### 2. Per-market scores

Each selected market gets a score computed from backend findings weighted by module relevance:

| Market | Relevant modules |
|---|---|
| EU | All (M1, M2, M3, M4, M5) |
| UK | M1 (withdrawal), M2 (consent), M3 (localization), M5 (tax) |
| US | M1 (privacy), M2 (CCPA) |
| CA | M1 (privacy), M2 |
| AU | M1 (privacy), M2 |

---

## Finding Status Reference

| Status | Displayed as | Included in score |
|---|---|---|
| `pass` | Clear (green) | Yes — 0 penalty |
| `warn` | Needs attention (amber) | Yes — half penalty |
| `fail` | Issue / Fix now (red) | Yes — full penalty |
| `not_detected` | Attention (amber) | No — informational |
| `error` | Scanner note (orange) | No — scanner failure |

A finding is marked **"Fix right away"** when: `status === 'fail'` AND `severity >= 80`.

---

## What's Not Automated (Requires Intake Answers or Manual Review)

These compliance areas are shown in the "Qualified out" section based on intake answers, but are **not crawled**:

- Tax registration & remittance (VAT, GST, sales tax thresholds)
- CE / UKCA marking and sector-specific conformity (Cosmetics, Toys, Electronics, Food, Medical)
- GPSR EU Responsible Person appointment
- Statutory conformity guarantee (EU 2-year, UK CRA 2015, AU ACL)
- Email/SMS marketing consent records (CASL, PECR, CAN-SPAM)
- DSA trader transparency for marketplaces
- Customs / DDP landed-cost handling at checkout
- Local payment methods (iDEAL, SEPA, Bancontact)
- Translation / localisation (FR Toubon, etc.)
