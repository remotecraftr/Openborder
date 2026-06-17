import { CRAWL } from './config';
import type { FetchResult } from './types';

// robots-parser has no default export type declaration — import carefully
// eslint-disable-next-line @typescript-eslint/no-require-imports
const robotsParser = require('robots-parser');

export class CrawlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrawlError';
  }
}

export class RequestCapError extends CrawlError {
  constructor() {
    super(`Request cap of ${CRAWL.REQUEST_CAP} reached`);
    this.name = 'RequestCapError';
  }
}

interface RobotsParser {
  isAllowed(url: string, ua: string): boolean | undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Crawler {
  readonly baseUrl: string;
  private requestCount = 0;
  private lastRequestTime = 0;
  private robots: RobotsParser | null = null;
  private cache = new Map<string, FetchResult>();

  constructor(domain: string) {
    const withScheme = domain.startsWith('http') ? domain : `https://${domain}`;
    const u = new URL(withScheme);
    this.baseUrl = `${u.protocol}//${u.host}`;
  }

  async init(): Promise<void> {
    const robotsUrl = `${this.baseUrl}/robots.txt`;
    try {
      const res = await this.fetchRaw(robotsUrl);
      const text = res.ok ? await res.text() : '';
      this.robots = robotsParser(robotsUrl, text);
    } catch {
      this.robots = null;
    }
  }

  async get(path: string): Promise<FetchResult> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;

    const cached = this.cache.get(url);
    if (cached) return cached;

    if (this.requestCount >= CRAWL.REQUEST_CAP) throw new RequestCapError();

    if (this.robots && this.robots.isAllowed(url, CRAWL.USER_AGENT) === false) {
      throw new CrawlError(`robots.txt disallows ${url}`);
    }

    await this.rateLimit();

    let lastErr: Error | null = null;
    const attempts = CRAWL.RETRY_ONCE ? 2 : 1;

    for (let i = 0; i < attempts; i++) {
      try {
        this.requestCount++;
        this.lastRequestTime = Date.now();
        const res = await this.fetchRaw(url);
        const text = await res.text();
        const result: FetchResult = {
          url,
          status: res.status,
          text,
          finalUrl: res.url,
        };
        this.cache.set(url, result);
        return result;
      } catch (err) {
        lastErr = err as Error;
        if (i < attempts - 1) await delay(1000);
      }
    }

    throw new CrawlError(`Failed to fetch ${url}: ${lastErr?.message}`);
  }

  private async rateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < CRAWL.RATE_LIMIT_MS) await delay(CRAWL.RATE_LIMIT_MS - elapsed);
  }

  private async fetchRaw(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CRAWL.REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': CRAWL.USER_AGENT },
        redirect: 'follow',
        // Disable Next.js fetch caching — the crawler must always make real requests
        cache: 'no-store',
      } as RequestInit);
    } finally {
      clearTimeout(timer);
    }
  }

  get requestsUsed(): number {
    return this.requestCount;
  }
}

export async function detectShopify(crawler: Crawler): Promise<boolean> {
  try {
    const r = await crawler.get('/products.json?limit=1');
    if (r.status === 200 && r.text.includes('"products"')) return true;
  } catch { /* continue */ }

  try {
    const r = await crawler.get('/');
    const t = r.text.toLowerCase();
    return t.includes('shopify') || t.includes('cdn.shopify.com') || t.includes('myshopify.com');
  } catch {
    return false;
  }
}
