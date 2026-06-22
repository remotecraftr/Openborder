// Per-module weight applied to each finding's severity contribution
export const MODULE_WEIGHT: Record<string, number> = {
  legal_pages: 1.0,
  consent_tracking: 0.9,
  localization: 0.5,
  accessibility: 0.6,
};

// How much of the severity a given status contributes to the penalty
export const STATUS_MULTIPLIER: Record<string, number> = {
  fail: 1.0,
  warn: 0.5,
  pass: 0.0,
  not_detected: 0.35,
  unverified: 0.35,
  error: 0.0,
};

export const CRAWL = {
  REQUEST_CAP: 20,
  REQUEST_TIMEOUT_MS: 10_000,
  RATE_LIMIT_MS: 400,
  RETRY_ONCE: true,
  USER_AGENT: 'OpenBorderCrawler/1.0 (+https://openborder.io/crawler)',
} as const;
