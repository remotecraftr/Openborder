# What I Would Build With 10 More Hours

## 1. M6 — GPSR EU Responsible Person Check (2 hrs)

The EU General Product Safety Regulation (GPSR, effective Dec 2024) requires non-EU manufacturers to name a Responsible Person in the EU on every product listing. I'd scan `/products.json` for all product descriptions and check for a Responsible Person mention. This is currently out of scope because it requires a full product catalogue scan — but with 10 more hours I'd paginate through `/products.json` in batches of 250, flag any product missing the declaration, and group findings by product handle.

**Impact:** Hard legal requirement for EU market entry, affects every physical-goods store.

---

## 2. Real-Time Consent Verification via Puppeteer Network Interception (2 hrs)

The current M2 check detects *presence* of a CMP but can't verify that tracking scripts actually fire *after* consent. A headless browser with `page.on('request')` could intercept network calls, click "Accept" and "Reject" on the cookie banner, and diff which trackers fired in each state. This is the difference between "you installed a CMP" and "your CMP actually works."

**Impact:** Closes the biggest false-positive hole in M2. Many stores have broken CMPs where scripts load regardless of consent choice.

---

## 3. M7 — Address Format Validation Signal (1 hr)

Check the checkout page (or the `/cart` → address form) for whether the store collects address fields appropriate for the target region: postal code format, state/county field, phone number format. This is a friction signal — wrong address form = abandoned checkouts from international customers.

**Impact:** Directly measurable conversion improvement for stores going international.

---

## 4. Shopify Markets Configuration Deep-Dive (1.5 hrs)

Expand M3 to call `/api/storefront/2024-01/graphql.json` (Shopify Storefront API, no auth required for published data) to enumerate enabled Markets, their currencies, price lists, and whether free shipping thresholds are market-aware. This gives a much more complete picture than inferring currency support from page HTML.

**Impact:** M3 currently has `low` confidence on currency detection — this would raise it to `high` for Shopify stores.

---

## 5. Scheduled Re-Scan + Score History (1 hr)

A simple Vercel cron job (`/api/cron/rescan`) that re-runs the audit daily and stores results in a Vercel KV store (Redis). The UI would show a sparkline of the readiness score over time, so merchants can see whether their compliance posture is improving. A webhook endpoint would let merchants trigger a re-scan on deploy.

**Impact:** Transforms the tool from a one-shot scanner into a compliance monitor.

---

## 6. Batch API + CSV Export (0.5 hrs)

A `POST /api/batch` endpoint that accepts an array of domains (up to 20) and runs them in parallel, returning a CSV with one row per finding. Useful for agencies managing multiple Shopify stores — single call audits their entire portfolio.

**Impact:** Unlocks a B2B use case — compliance agencies, Shopify Plus partners.

---

## 7. LLM-Enhanced Suggestions for Every Finding (1 hr)

Currently `enhanceSuggestion()` is wired up but only called selectively. With more time I'd call it for every `fail` and `warn` finding, with a per-module system prompt that knows which regulation applies and what Shopify admin path the merchant should navigate to. The result is a per-finding "how to fix this in Shopify" walkthrough, not just a description of the problem.

**Impact:** Dramatically reduces time-to-fix for non-technical merchants.

---

## 8. Slack / Email Digest on Score Drop (1 hr)

Pair with item 5 (score history). If the readiness score drops more than 5 points between scans, fire a Slack webhook or email alert. Compliance regressions happen silently — a theme update can remove a CMP integration without anyone noticing.

**Impact:** Prevents silent regressions from theme updates, app installs, or developer changes.

---

## Summary Table

| Feature | Hours | Impact |
|---|---|---|
| M6 GPSR Responsible Person scan | 2.0 | Legal blocker for EU |
| Real-time consent verification | 2.0 | Closes M2 false-positive gap |
| Address format validation | 1.0 | Conversion improvement |
| Shopify Markets GraphQL deep-dive | 1.5 | M3 confidence: low → high |
| Scheduled re-scan + score history | 1.0 | Compliance monitoring |
| Batch API + CSV export | 0.5 | Agency/B2B use case |
| LLM suggestions for all findings | 1.0 | Merchant time-to-fix |
| Slack/email alert on score drop | 1.0 | Silent regression detection |
| **Total** | **10.0** | |
