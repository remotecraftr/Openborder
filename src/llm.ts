/**
 * LLM layer — scoped, evidence-bound (PRD §3).
 *
 * Rules:
 *  - Operates ONLY on text the crawler already fetched (never a URL to navigate)
 *  - Must cite the evidence it used (cited_text in response)
 *  - Gracefully returns null if GEMINI_API_KEY absent or call fails
 */

const MODEL = 'gemini-2.0-flash';
const MAX_POLICY_CHARS = 4000;

export interface WithdrawalVerdict {
  sufficient: boolean;
  foundElements: string[];
  missingElements: string[];
  citedText: string;
  reasoning: string;
}

const WITHDRAWAL_PROMPT = `You are a compliance analyst reviewing an e-commerce returns policy for EU consumer law compliance.

You will be given the full text of a returns/refund policy page. Determine whether it contains a legally sufficient EU withdrawal / cooling-off clause under the Consumer Rights Directive (2011/83/EU).

A sufficient clause must include ALL of:
1. A 14-day withdrawal period (from delivery)
2. The right to cancel without giving a reason
3. Who bears the cost of return shipping
4. A refund timeline (within 14 days of receiving the cancellation)

Respond with a JSON object ONLY (no markdown fences):
{
  "sufficient": true | false,
  "foundElements": ["elements from 1-4 that ARE present"],
  "missingElements": ["elements from 1-4 that are MISSING"],
  "citedText": "exact excerpt(s) you based this on, or empty string",
  "reasoning": "one sentence verdict"
}

Policy text:
---
{POLICY_TEXT}
---`;

const SUGGESTION_PROMPT = `You are a compliance advisor helping an e-commerce merchant fix an international readiness issue.

Write a clear, actionable 2-3 sentence suggestion for the merchant. Rules:
- Specific and practical — name the exact thing to add/change
- Mention the relevant regulation/market (EU, UK, US) if applicable
- Do NOT invent facts not in the finding

Finding:
  Title: {TITLE}
  Status: {STATUS}
  Evidence: {EVIDENCE}
  Current suggestion: {CURRENT}

Respond with only the improved suggestion text (no preamble).`;

function getModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(key);
    return genAI.getGenerativeModel({ model: MODEL });
  } catch {
    return null;
  }
}

export async function judgeWithdrawalClause(
  policyText: string
): Promise<WithdrawalVerdict | null> {
  const model = getModel();
  if (!model) return null;

  const truncated =
    policyText.length > MAX_POLICY_CHARS
      ? policyText.slice(0, MAX_POLICY_CHARS) + '\n[... text truncated for analysis ...]'
      : policyText;

  const prompt = WITHDRAWAL_PROMPT.replace('{POLICY_TEXT}', truncated);

  try {
    const result = await model.generateContent(prompt);
    let raw: string = result.response.text().trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(raw);
    const required = ['sufficient', 'foundElements', 'missingElements', 'citedText', 'reasoning'];
    if (!required.every((k: string) => k in parsed)) return null;

    return parsed as WithdrawalVerdict;
  } catch {
    return null;
  }
}

export async function enhanceSuggestion(
  title: string,
  status: string,
  evidence: string,
  currentSuggestion: string
): Promise<string | null> {
  const model = getModel();
  if (!model) return null;

  const prompt = SUGGESTION_PROMPT
    .replace('{TITLE}', title)
    .replace('{STATUS}', status)
    .replace('{EVIDENCE}', evidence.slice(0, 500))
    .replace('{CURRENT}', currentSuggestion.slice(0, 500));

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim() || null;
  } catch {
    return null;
  }
}
