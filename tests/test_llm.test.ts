import { judgeWithdrawalClause, enhanceSuggestion } from '../src/llm';

describe('judgeWithdrawalClause', () => {
  it('returns null when GEMINI_API_KEY is not set', async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = await judgeWithdrawalClause('Some policy text.');
    expect(result).toBeNull();
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  });
});

describe('enhanceSuggestion', () => {
  it('returns null when GEMINI_API_KEY is not set', async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = await enhanceSuggestion('title', 'fail', 'evidence', 'suggestion');
    expect(result).toBeNull();
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  });

  it('LLM prompt does not contain navigation instructions', () => {
    // The prompt strings must not ask the LLM to navigate, fetch, or browse
    // We import the module to check at module-load time — these are static checks
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/llm.ts'), 'utf8');
    const forbidden = ['navigate to', 'fetch the url', 'browse to', 'go to http', 'visit http'];
    for (const phrase of forbidden) {
      expect(src.toLowerCase()).not.toContain(phrase);
    }
  });
});
