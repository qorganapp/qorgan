import {
  AgentConversation,
  AgentRun,
  Scan,
  ScanSummary,
  SpaceDetail,
  SpaceGraph,
  SpaceListItem,
  SpaceOverview,
} from '../api/api.types';
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

  describe('spaces', () => {
    const demoSpace = () => (call('GET', '/api/spaces').body as SpaceListItem[])[0];

    it('starts with a demo space that holds both repositories', () => {
      const space = demoSpace();
      expect(space.repositoryCount).toBe(2);
      const overview = call('GET', `/api/spaces/${space.id}/overview`).body as SpaceOverview;
      expect(overview.totals).toMatchObject({ repositories: 2, scanned: 1 });
      expect(overview.totals.open).toBeGreaterThan(0);
      const infra = overview.repositories.find((r) => r.repositoryId === 'r-infra')!;
      expect(infra).toMatchObject({ lastScan: null, open: 0 });
    });

    it('creates, renames and deletes a space, and adds and removes repositories', () => {
      const created = call('POST', '/api/spaces', {
        name: ' Shop ',
        repositoryIds: ['r-shop', 'nope'],
      }).body as SpaceDetail;
      expect(created.name).toBe('Shop');
      expect(created.repositories.map((r) => r.id)).toEqual(['r-shop']);

      const base = `/api/spaces/${created.id}`;
      const added = call('POST', `${base}/repositories`, { repositoryIds: ['r-shop', 'r-infra'] })
        .body as SpaceDetail;
      expect(added.repositories).toHaveLength(2);
      const removed = call('DELETE', `${base}/repositories/r-shop`).body as SpaceDetail;
      expect(removed.repositories.map((r) => r.id)).toEqual(['r-infra']);

      expect((call('PATCH', base, { name: 'Infra' }).body as SpaceDetail).name).toBe('Infra');
      expect(call('DELETE', base).status).toBe(204);
      expect(call('GET', base).status).toBe(404);
    });

    it('builds the relationship map over time and marks it stale when repositories change', () => {
      const base = `/api/spaces/${demoSpace().id}`;
      expect((call('GET', `${base}/graph`).body as SpaceGraph).status).toBe('none');
      expect((call('POST', `${base}/graph/refresh`).body as SpaceGraph).status).toBe('running');

      now += 6000;
      const graph = call('GET', `${base}/graph`).body as SpaceGraph;
      expect(graph.status).toBe('done');
      expect(graph.nodes).toHaveLength(2);
      expect(graph.edges.map((e) => e.kind).sort()).toEqual(['calls', 'shared_dependency']);
      const activity = call('GET', `${base}/agent/activity`).body as AgentRun[];
      expect(activity.some((r) => r.kind === 'map' && r.spaceId)).toBe(true);

      now += 1000;
      call('DELETE', `${base}/repositories/r-infra`);
      const stale = call('GET', `${base}/graph`).body as SpaceGraph;
      expect(stale.stale).toBe(true);
      expect(stale.edges).toEqual([]);
    });

    it('keeps agent conversations in the space with an optional repository in focus', () => {
      const base = `/api/spaces/${demoSpace().id}`;
      const started = call('POST', `${base}/agent/conversations`, {
        content: 'How do these repositories depend on each other?',
        repositoryId: null,
      }).body as AgentConversation;
      expect(started.repositoryId).toBeNull();
      expect(
        call('POST', `${base}/agent/conversations`, { content: 'hi', repositoryId: 'r-other' })
          .status,
      ).toBe(404);

      now += 5000;
      const answered = call('GET', `/api/agent/conversations/${started.id}`)
        .body as AgentConversation;
      expect(answered.messages![1].content).toContain('platform-infra deploys demo-shop');
      const focused = call('POST', `/api/agent/conversations/${started.id}/messages`, {
        content: 'What should I fix first?',
        repositoryId: 'r-shop',
      }).body as AgentConversation;
      expect(focused.repositoryId).toBe('r-shop');
      expect(call('GET', `${base}/agent/conversations`).body).toHaveLength(1);
    });
  });
});
