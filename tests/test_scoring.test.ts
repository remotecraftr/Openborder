import { computeScore, severityLabel } from '../src/scoring';
import type { Finding } from '../src/types';

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    module: 'legal_pages',
    checkId: 'test',
    title: 'Test',
    status: 'pass',
    severity: 0,
    confidence: 'high',
    evidence: {},
    suggestion: '',
    ...overrides,
  };
}

describe('computeScore', () => {
  it('returns 100 for empty findings', () => {
    expect(computeScore([])).toBe(100);
  });

  it('returns 100 when all findings are pass', () => {
    const findings = [
      makeFinding({ status: 'pass', severity: 0 }),
      makeFinding({ status: 'pass', severity: 0 }),
    ];
    expect(computeScore(findings)).toBe(100);
  });

  it('returns less than 100 for a fail finding', () => {
    const findings = [makeFinding({ status: 'fail', severity: 90 })];
    expect(computeScore(findings)).toBeLessThan(100);
  });

  it('fail has higher penalty than warn at same severity', () => {
    const withFail = [makeFinding({ status: 'fail', severity: 50 })];
    const withWarn = [makeFinding({ status: 'warn', severity: 50 })];
    expect(computeScore(withFail)).toBeLessThan(computeScore(withWarn));
  });

  it('never goes below 0', () => {
    const findings = Array.from({ length: 10 }, () =>
      makeFinding({ status: 'fail', severity: 100, module: 'legal_pages' })
    );
    expect(computeScore(findings)).toBeGreaterThanOrEqual(0);
  });

  it('not_detected does not penalise score', () => {
    const withDetected = [makeFinding({ status: 'not_detected', severity: 50 })];
    expect(computeScore(withDetected)).toBe(100);
  });
});

describe('severityLabel', () => {
  it('returns good for score >= 80', () => expect(severityLabel(85)).toBe('good'));
  it('returns needs_work for 60-79', () => expect(severityLabel(65)).toBe('needs_work'));
  it('returns at_risk for 40-59', () => expect(severityLabel(50)).toBe('at_risk'));
  it('returns critical for < 40', () => expect(severityLabel(25)).toBe('critical'));
});
