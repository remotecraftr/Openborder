export type Status = 'pass' | 'warn' | 'fail' | 'not_detected' | 'error' | 'unverified';
export type Confidence = 'high' | 'medium' | 'low';

export interface Evidence {
  url?: string;
  selector?: string;
  snippet?: string;
  value?: string;
}

export interface Finding {
  module: string;
  checkId: string;
  title: string;
  status: Status;
  severity: number;       // 1–100, meaningful for warn/fail; 0 for pass
  confidence: Confidence;
  evidence: Evidence;
  suggestion: string;
  tools?: string[];
}

export interface ErrorRecord {
  module: string;
  checkId: string;
  message: string;
  detail?: string;
}

export interface AuditResult {
  domain: string;
  platform: string;
  fetchedAt: string;      // ISO 8601
  readinessScore: number; // 0–100 weighted rollup
  findings: Finding[];
  errors: ErrorRecord[];
  adMetrics?: {
    facebook: { count: number; totalSpend: number; regions: string[] };
    google: { count: number; totalSpend: number; regions: string[] };
  };
}

export interface FetchResult {
  url: string;
  status: number;
  text: string;
  finalUrl: string;
}
