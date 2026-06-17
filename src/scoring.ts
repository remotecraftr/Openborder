import { MODULE_WEIGHT, STATUS_MULTIPLIER } from './config';
import type { Finding } from './types';

/**
 * Compute 0–100 readiness score (higher = more ready).
 *
 * Only pass/warn/fail findings participate in the score.
 * not_detected and error findings are excluded from both penalty and maxPossible
 * so they neither inflate nor deflate the score — they are informational only.
 *
 * penalty_i = severity_i × module_weight × status_multiplier
 * score = 100 − (total_penalty / max_possible) × 100
 */
const SCORED_STATUSES = new Set(['pass', 'warn', 'fail']);

export function computeScore(findings: Finding[]): number {
  const scoreable = findings.filter(f => SCORED_STATUSES.has(f.status));
  if (!scoreable.length) return 100;

  let totalPenalty = 0;
  let maxPossible = 0;

  for (const f of scoreable) {
    const weight = MODULE_WEIGHT[f.module] ?? 1.0;
    const mult = STATUS_MULTIPLIER[f.status] ?? 0;
    totalPenalty += f.severity * weight * mult;
    maxPossible += 100 * weight * (STATUS_MULTIPLIER['fail'] ?? 1);
  }

  if (maxPossible === 0) return 100;
  return Math.max(0, Math.min(100, 100 - (totalPenalty / maxPossible) * 100));
}

export type ScoreLabel = 'good' | 'needs_work' | 'at_risk' | 'critical';

export function severityLabel(score: number): ScoreLabel {
  if (score >= 80) return 'good';
  if (score >= 60) return 'needs_work';
  if (score >= 40) return 'at_risk';
  return 'critical';
}
