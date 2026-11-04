import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Scan, ScanSummary } from '../api/api.types';
import { QorganApi } from '../api/qorgan-api';
import { POLL_INTERVAL_MS, ScanSession } from './scan-session';

const scan = (status: Scan['status'], extra: Partial<Scan> = {}): Scan => ({
  id: 's1',
  repositoryId: 'r1',
  branch: 'main',
  commitSha: null,
  modules: ['supply_chain', 'secrets'],
  status,
  trigger: 'manual',
  error: null,
  startedAt: null,
  finishedAt: null,
  createdAt: '',
  moduleRuns: [],
  ...extra,
});

describe('ScanSession', () => {
  let api: {
    scans: ReturnType<typeof vi.fn>;
    scan: ReturnType<typeof vi.fn>;
    summary: ReturnType<typeof vi.fn>;
    startScan: ReturnType<typeof vi.fn>;
  };
  let session: ScanSession;

  beforeEach(() => {
    vi.useFakeTimers();
    api = { scans: vi.fn(), scan: vi.fn(), summary: vi.fn(), startScan: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: QorganApi, useValue: api }] });
    session = TestBed.inject(ScanSession);
  });

  afterEach(() => vi.useRealTimers());

  it('is idle for a repository without scans', () => {
    api.scans.mockReturnValue(of([]));
    session.open('r1');
    expect(session.phase()).toBe('idle');
  });

  it('polls a running scan until it is done, then loads the summary and stops', () => {
    api.scans.mockReturnValue(of([scan('running')]));
    api.scan
      .mockReturnValueOnce(
        of(scan('running', { moduleRuns: [{ module: 'secrets', status: 'done' } as never] })),
      )
      .mockReturnValueOnce(of(scan('done')));
    api.summary.mockReturnValue(of({ fixNow: [] } as unknown as ScanSummary));

    session.open('r1');
    expect(session.phase()).toBe('scanning');
    expect(session.moduleProgress()).toEqual({ supply_chain: 'running', secrets: 'running' });

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(session.progress()).toBe(0.5);
    expect(session.moduleProgress().secrets).toBe('done');

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(session.phase()).toBe('results');
    expect(session.lastDoneScanId()).toBe('s1');

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
    expect(api.scan).toHaveBeenCalledTimes(2);
  });

  it('shows the failure state without polling', () => {
    api.scans.mockReturnValue(of([scan('failed', { error: 'clone failed' })]));
    session.open('r1');
    expect(session.phase()).toBe('failed');
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    expect(api.scan).not.toHaveBeenCalled();
  });

  it('stops polling the old repository after switching', () => {
    api.scans.mockReturnValueOnce(of([scan('running')])).mockReturnValueOnce(of([]));
    session.open('r1');
    session.open('r2');
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    expect(api.scan).not.toHaveBeenCalled();
    expect(session.phase()).toBe('idle');
  });

  it('does not reload when opened again for the same repository (no effect loops)', () => {
    api.scans.mockReturnValue(of([]));
    session.open('r1');
    session.open('r1');
    session.open('r1');
    expect(api.scans).toHaveBeenCalledTimes(1);
  });
});
