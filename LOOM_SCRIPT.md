# Loom Video Script — OpenBorder Readiness Scanner Demo

**Duration:** ~5 minutes
**Format:** Screen share of local dev (`http://localhost:3000`) + terminal + voiceover
**Demo domain:** `gymshark.com` (real Shopify store, good mix of passes and failures)

---

## [0:00–0:20] Hook

> "If you run a Shopify store and you're planning to sell into the EU, UK, or US — there are roughly a dozen compliance checks you need to pass before you're actually ready. Missing one of them can mean GDPR fines, ad account suspensions, or failed market entry. This tool scans any Shopify storefront in about 30 seconds and tells you exactly what to fix."

---

## [0:20–0:45] Show the UI — type a domain

> "Here's the OpenBorder Readiness Scanner. I'll type in gymshark.com — a real Shopify store with millions of customers — and hit Scan."

*[Type `gymshark.com` into the input. Hit Scan. Let it run.]*

> "While it's running — the scanner is making a series of HTTP requests directly to the storefront. No browser automation, no JavaScript execution for M1 through M3. Just deterministic crawls against fixed URL surfaces that Shopify exposes on every store: the policies URLs, the homepage HTML, the products JSON endpoint."

---

## [0:45–1:20] Score card

*[Results appear. Point at the readiness score circle.]*

> "We get a readiness score — zero to a hundred. Gymshark scores [X]. The score is a weighted penalty rollup: each failing check has a severity between 1 and 100, and modules are weighted by legal criticality. Legal pages carry a weight of 1.0 — the heaviest — because a missing privacy policy or broken withdrawal clause is a hard blocker for EU sales. Consent and tracking is 0.9, accessibility 0.6, localization 0.5."

> "Three summary numbers at a glance: [X] fails, [Y] warns, [Z] passes. Let's walk through the most important ones."

---

## [1:20–2:15] M1 — Legal Pages (click to expand findings)

*[Click the EU 14-Day Withdrawal Clause row to expand it.]*

> "This is the most common gap we see. Gymshark has a returns policy — it's not a 404 — but it doesn't contain a legally sufficient EU withdrawal clause. Under the EU Consumer Rights Directive, every returns policy sold to EU customers must explicitly state: a 14-day window from delivery, the right to cancel without giving a reason, who pays return shipping, and the refund timeline."

> "The scanner uses Gemini Flash to read the policy text — not to navigate, just to judge the already-fetched content. Gemini cites the exact excerpt it based the verdict on, so the finding is auditable. Without a Gemini key it falls back to regex — still works, just lower confidence."

*[Click the EU Legal Imprint row.]*

> "This one surprises most merchants. German, Austrian, and Swiss law require a legal imprint — called an Impressum — on every commercial website. The scanner checks the homepage footer for a link to /pages/impressum or a VAT registration number. If you're selling into DACH markets, this is a legal obligation, not optional."

*[Click the US Opt-Out row.]*

> "And this one matters for US-bound stores. California's CCPA and CPRA require a 'Do Not Sell or Share My Personal Information' link if you share data with ad platforms. We scan the privacy policy text for that language."

---

## [2:15–2:55] M2 — Consent & Tracking

*[Scroll to M2 findings.]*

> "Module 2 is the one that gets stores in trouble with Meta and Google. We scan the homepage HTML for nine known CMP signatures — Cookiebot, OneTrust, Didomi, Shopify's own customerPrivacy API, and others — and for nine known tracking pixels: GA4, GTM, Meta Pixel, TikTok, Klaviyo, and more."

*[Point at the Tracker Without Consent Gate finding.]*

> "Gymshark loads Google Analytics 4 without a detectable consent gate. Under GDPR and the ePrivacy Directive, you cannot load tracking code before the user explicitly accepts. This is severity 88 — one of the highest — because it's the single most common reason Shopify stores get their Meta ad accounts suspended or hit with data protection authority fines."

> "Note: confidence is medium. Static HTML detection can't prove a script fires before consent — that requires network interception. We say so in the evidence."

---

## [2:55–3:25] M3 — Localization

*[Scroll to M3 findings.]*

> "Module 3 checks Shopify-specific localization signals: hreflang tags with an x-default, the localization form in the DOM, currency selector markup, and the presentmentCurrencies array in page JS."

> "Gymshark passes hreflang and the country selector — they've done the basic work. But only USD is detected in the currency configuration. For a store of this size targeting international customers, that's a conversion problem."

---

## [3:25–3:50] M4 — Accessibility (terminal)

*[Switch to terminal window.]*

> "Module 4 is the axe-core accessibility scan. It can't run serverless — Playwright needs a real process. So I'll show it from the CLI."

```bash
npm run analyze gymshark.com -- --json | grep -A8 '"module": "accessibility"'
```

> "axe-core runs in headless Chromium on the homepage and a product page, injects the axe library, and reports WCAG violations with their impact level. Critical violations score severity 85, serious 65, moderate 40. This is real automated WCAG coverage — not an overlay widget, actual DOM-level analysis."

---

## [3:50–4:15] JSON export and data model

*[Back to browser. Click 'Download full JSON report'.]*

> "Every finding ships as structured JSON. Module ID, check ID, status, severity 1–100, confidence, evidence with URL and exact snippet, and a plain-language suggestion. This is designed to be machine-readable — you could pipe it into a Shopify app, a Slack alert, or a CI/CD gate that blocks deployment if the compliance score drops below a threshold."

---

## [4:15–4:40] Architecture callout

> "The architecture is deliberately deterministic, not agentic. Same domain, same findings, every run — that's a requirement when you're asserting legal gaps. The LLM is scoped to a single tool call operating only on content the crawler already fetched, and it must cite its evidence. It never navigates."

> "Adding a new check is three things: a Finding shape, a detection method, and a test. The test suite has 40 tests that run fully offline — no network calls, no API key required."

---

## [4:40–5:00] Close

> "This covers five modules: legal pages, consent hygiene, localization, accessibility, and tax display signals. The architecture is ready for the next layer — real-time consent verification via network interception, GPSR EU Responsible Person scanning across the product catalogue, and Shopify Markets GraphQL for high-confidence currency data."

> "Stack: TypeScript, Next.js, Playwright, Gemini Flash, deployed on Vercel. The CLI, the web UI, and the JSON API all share the same analysis engine."

*[End recording.]*

---

## Recording Checklist

- [ ] `npm run dev` running at localhost:3000
- [ ] Terminal open in a second window
- [ ] `.env.local` has `GEMINI_API_KEY` set (for LLM withdrawal clause)
- [ ] Playwright installed (`npm install playwright && npx playwright install chromium`)
- [ ] Scan `gymshark.com` live — don't pre-record results
- [ ] Show both browser UI and terminal CLI view
