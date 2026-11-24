import { Scan, ScanSummary } from '../api/api.types';
import { MockBackend } from './mock-backend';

describe('MockBackend', () => {
  let now: number;
  let mock: MockBackend;
  const call = (method: string, url: string, body: unknown = null) => {
    const [path, query = ''] = url.split('?');
    return mock.handle({ method, url: path, params: new URLSearchParams(query), body });
  };

  beforeEach(() => {
    localStorage.clear();
    now = 1_000_000_000_000;
    mock = new MockBackend(() => now);
    call('POST', '/api/auth/sign-in', { username: 'demo', password: 'x' });
  });

  it('requires a session', () => {
    call('POST', '/api/auth/logout');
    expect(call('GET', '/api/repositories').status).toBe(401);
  });

  it('simulates a scan progressing module by module', () => {
    const started = call('POST', '/api/repositories/r-infra/scans').body as Scan;
    expect(started.status).toBe('queued');

    now += 3000;
    const mid = call('GET', `/api/scans/${started.id}`).body as Scan;
    expect(mid.status).toBe('running');
    expect(mid.moduleRuns!.length).toBeGreaterThan(0);
    expect(mid.moduleRuns!.length).toBeLessThan(4);

    now += 10_000;
    const done = call('GET', `/api/scans/${started.id}`).body as Scan;
    expect(done.status).toBe('done');
    expect(done.moduleRuns).toHaveLength(4);
  });

  it('drops ignored findings from the fix-now list', () => {
    const [scan] = call('GET', '/api/repositories/r-shop/scans').body as Scan[];
    const before = call('GET', `/api/scans/${scan.id}/summary`).body as ScanSummary;
    expect(before.fixNow.length).toBe(6);

    for (const id of before.fixNow[0].findingIds) {
      call('PATCH', `/api/findings/${id}`, { status: 'ignored' });
    }
    const after = call('GET', `/api/scans/${scan.id}/summary`).body as ScanSummary;
    expect(after.fixNow.length).toBe(5);
    expect(after.totals.open).toBe(before.totals.open - before.fixNow[0].findingIds.length);
  });

  it('never ships raw secrets in demo data', () => {
    const [scan] = call('GET', '/api/repositories/r-shop/scans').body as Scan[];
    const body = JSON.stringify(call('GET', `/api/scans/${scan.id}/findings?module=secrets`).body);
    expect(body).not.toMatch(/ghp_[A-Za-z0-9]{20,}|FAKE_TOKEN_FOR_TESTS/);
  });
});
