# Vercel Deployment Guide

## Prerequisites

- A free [Vercel account](https://vercel.com/signup)
- A [GitHub account](https://github.com) (Vercel deploys from GitHub)
- Node.js 18+ installed locally
- (Optional) `GEMINI_API_KEY` for LLM-enhanced M1 analysis — free at https://aistudio.google.com/apikey

---

## Step 1 — Push to GitHub

```bash
cd /Users/apple/Documents/OpenBorder-TS

git init
git add .
git commit -m "Initial commit: OpenBorder Readiness Scanner"

# Create a new repo on GitHub (github.com → New repository → name it openborder-ts)
git remote add origin https://github.com/YOUR_USERNAME/openborder-ts.git
git branch -M main
git push -u origin main
```

---

## Step 2 — Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **"Import Git Repository"**
3. Select your `openborder-ts` GitHub repo
4. Vercel auto-detects **Next.js** — no framework config needed
5. Click **Deploy**

Your first deploy runs in ~60 seconds. Vercel gives you a URL like:
`https://openborder-ts-yourname.vercel.app`

---

## Step 3 — Add Environment Variables (optional)

Without `GEMINI_API_KEY`, M1 uses regex detection (confidence: medium). With it, M1 uses Gemini Flash (confidence: high).
To enable M4 (Accessibility) and M3 advanced rendering on Vercel without exceeding the free-tier memory limit, you can attach a remote browser service.

1. In your Vercel project dashboard → **Settings → Environment Variables**
2. Add:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** `AIza...` (your key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey))
   - **Environment:** Production, Preview, Development
3. (Optional) For serverless Playwright support:
   - **Name:** `BROWSER_WS_ENDPOINT`
   - **Value:** `wss://chrome.browserless.io?token=...` (or any other CDP endpoint)
3. Click **Save**
4. Go to **Deployments → Redeploy** (so the new env var takes effect)

---

## Step 4 — Verify

Open `https://YOUR_VERCEL_URL/api/analyze?domain=allbirds.com` in your browser.

You should see a JSON response with `readinessScore`, `findings`, etc.

Or use the UI: open the root URL, type `allbirds.com`, click **Scan**.

---

## Free Tier Limits

| Resource | Free Tier Limit | This app's usage |
|---|---|---|
| Function duration | 60s max | Set in vercel.json |
| Bandwidth | 100 GB/month | Negligible |
| Deployments | Unlimited | — |
| Serverless invocations | 100k/month | Each scan = 1 |

**M4 (axe-core accessibility)** runs seamlessly on Vercel via the `@sparticuz/chromium` package, or by supplying a remote managed browser endpoint (`BROWSER_WS_ENDPOINT`).

---

## Local Development

```bash
npm install
cp .env.example .env.local
# Edit .env.local and add GEMINI_API_KEY

npm run dev        # starts at http://localhost:3000
npm test           # runs 40 tests, no API key needed
npm run build      # production build check
```

## CLI Usage

```bash
npm run analyze allbirds.com
npm run analyze allbirds.com -- --json
```
