import type { NextApiRequest, NextApiResponse } from 'next';
import { analyze } from '../../src/orchestrator';
import type { ProgressEvent } from '../../src/orchestrator';

export const config = {
  maxDuration: 120,
  api: { responseLimit: false },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const domain = req.body?.domain as string | undefined;
  if (!domain || typeof domain !== 'string' || domain.trim().length === 0) {
    return res.status(400).json({ error: 'domain is required' });
  }

  const clean = domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9\-.]+)?[a-zA-Z0-9](\.[a-zA-Z]{2,})+$/.test(clean)) {
    return res.status(400).json({ error: 'Invalid domain format' });
  }

  // SSE headers — disable all buffering so events arrive immediately
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function send(data: object) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // flush() is available when compression middleware wraps the response
    const r = res as unknown as { flush?: () => void };
    if (typeof r.flush === 'function') r.flush();
  }

  const crashGuard = (reason: unknown) => {
    if (!res.writableEnded) {
      send({ type: 'fatal', message: `Unexpected crash: ${String(reason)}` });
      res.end();
    }
  };
  process.once('unhandledRejection', crashGuard);

  try {
    const result = await analyze(clean, {}, (event: ProgressEvent) => {
      send(event);
    });
    send({ type: 'done', result });
  } catch (err) {
    console.error('[analyze-stream]', err);
    send({ type: 'fatal', message: `Analysis failed: ${String(err)}` });
  } finally {
    process.off('unhandledRejection', crashGuard);
    res.end();
  }
}
