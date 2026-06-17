import { Crawler } from '../src/crawler';

// We only test construction and caching — no live network calls
describe('Crawler construction', () => {
  it('normalises domain without scheme', () => {
    const c = new Crawler('allbirds.com');
    expect(c.baseUrl).toBe('https://allbirds.com');
  });

  it('preserves https scheme', () => {
    const c = new Crawler('https://allbirds.com');
    expect(c.baseUrl).toBe('https://allbirds.com');
  });

  it('strips trailing path', () => {
    const c = new Crawler('https://allbirds.com/en-us');
    expect(c.baseUrl).toBe('https://allbirds.com');
  });

  it('starts with 0 requests used', () => {
    const c = new Crawler('example.com');
    expect(c.requestsUsed).toBe(0);
  });
});
