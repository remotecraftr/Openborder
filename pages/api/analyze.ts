import type { NextApiRequest, NextApiResponse } from 'next';
import { analyze } from '../../src/orchestrator';
import type { AuditResult } from '../../src/types';

export const config = {
  maxDuration: 60,
  api: {
    // Disable Next.js body size limit issues; response timeout handled by Vercel maxDuration above
    responseLimit: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AuditResult | { error: string }>
) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const domain =
    req.method === 'POST'
      ? (req.body?.domain as string | undefined)
      : (req.query.domain as string | undefined);

  if (!domain || typeof domain !== 'string' || domain.trim().length === 0) {
    return res.status(400).json({ error: 'domain is required' });
  }

  const clean = domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9\-\.]+)?[a-zA-Z0-9](\.[a-zA-Z]{2,})+$/.test(clean)) {
    return res.status(400).json({ error: 'Invalid domain format' });
  }

  try {
    const result = await analyze(clean);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[analyze]', err);
    return res.status(500).json({ error: `Analysis failed: ${String(err)}` });
  }
}
