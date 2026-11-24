import {
  AgentRun,
  Finding,
  FixNowItem,
  ModuleRun,
  Page,
  Repository,
  Scan,
  ScanModule,
  ScanSummary,
  SEVERITIES,
  Severity,
  SpaceDetail,
  SpaceListItem,
  SpaceOverview,
} from '../api/api.types';
import demo from './demo-scan.json';
import {
  applyDemoVerdicts,
  DEMO_FIXES,
  demoActivity,
  demoGraph,
  demoRunDetails,
  MockChat,
} from './mock-agent';

export interface MockRequest {
  method: string;
  url: string;
  params: URLSearchParams;
  body: unknown;
}

export interface MockResponse {
  status: number;
  body: unknown;
}

const MODULES: ScanModule[] = ['supply_chain', 'secrets', 'code_audit', 'infra'];

/** Когда (мс от старта) модуль «заканчивается» — разное время, чтобы анимация была живой. */
const MODULE_DONE_AT: Record<ScanModule, number> = {
  supply_chain: 2600,
  secrets: 3800,
  code_audit: 5200,
  infra: 6600,
};
const QUEUED_FOR = 900;
const SCAN_DURATION = 7200;
/** После сканеров агент разбирает находки — скан ещё «running». */
const TRIAGE_FOR = 2600;

const TOOLS: Record<ScanModule, string[]> = {
  supply_chain: ['osv-scanner', 'trivy', 'typosquat'],
  secrets: ['gitleaks'],
  code_audit: ['semgrep'],
  infra: ['checkov', 'trivy-config'],
};

const AUTH_KEY = 'qorgan.mock.session';

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Имитация API Qorgan в памяти. Находки — реальный вывод сканеров на тестовом уязвимом
 * репозитории (см. qorgan-app-backend/src/domains/scanner/__fixtures__).
 */
export class MockBackend {
  private readonly repos: Repository[] = [
    repo('r-shop', 'qorganapp/demo-shop', 'main', true),
    repo('r-infra', 'qorganapp/platform-infra', 'main', true),
  ];
  private readonly scans: (Scan & { startedMs: number })[] = [];
  private readonly findings = new Map<string, Finding[]>();
  private readonly chat: MockChat;
  /** В демо уже есть пространство с обоими репозиториями — дэшборд сразу не пустой. */
  private readonly spaces: MockSpace[] = [];

  constructor(private readonly now: () => number = Date.now) {
    this.chat = new MockChat(now);
    // У первого репозитория уже есть вчерашний скан — сразу видно экран результатов.
    const yesterday = this.now() - 26 * 3600_000;
    this.createScan('r-shop', yesterday);
    this.spaces.push(this.newSpace('Demo space', ['r-shop', 'r-infra'], yesterday));
  }

  handle(req: MockRequest): MockResponse {
    const { method, url } = req;
    const path = url.replace(/\?.*$/, '');
    let m: RegExpMatchArray | null;

    if (path.startsWith('/api/auth/')) return this.auth(method, path, req.body);
    if (!this.signedIn()) return { status: 401, body: { message: 'Unauthorized' } };

    if (method === 'GET' && path === '/api/repositories') return ok(this.repos);
    if (method === 'GET' && path === '/api/agent/status')
      return ok({ enabled: true, provider: 'anthropic', model: 'claude-opus-5-5' });
    if (path === '/api/spaces') {
      if (method === 'POST') {
        const { name, repositoryIds = [] } = req.body as { name: string; repositoryIds?: string[] };
        const space = this.newSpace(name.trim(), this.known(repositoryIds));
        this.spaces.push(space);
        return ok(this.detail(space));
      }
      return ok(this.spaces.map((sp) => this.listItem(sp)));
    }
    if ((m = path.match(/^\/api\/spaces\/([^/]+)(\/.*)?$/))) {
      const space = this.spaces.find((sp) => sp.id === m![1]);
      if (!space) return notFound();
      return this.space(space, method, m[2] ?? '', req.body);
    }
    if ((m = path.match(/^\/api\/repositories\/([^/]+)\/agent\/(activity|fixes|settings)$/))) {
      const repo = this.repos.find((r) => r.id === m![1]);
      if (!repo) return notFound();
      switch (m[2]) {
        case 'activity':
          return ok(demoActivity(repo.id, this.lastDoneAt(repo.id)));
        case 'fixes':
          return ok(repo.id === 'r-shop' ? DEMO_FIXES : []);
        case 'settings':
          Object.assign(repo, req.body as object);
          return ok(repo);
      }
    }
    if ((m = path.match(/^\/api\/agent\/conversations\/([^/]+)(\/messages)?$/))) {
      if (m[2]) {
        const { content, repositoryId } = req.body as {
          content: string;
          repositoryId?: string | null;
        };
        const res = this.chat.post(m[1], content, repositoryId);
        if (res === 'busy')
          return {
            status: 409,
            body: { message: 'The agent is still answering the previous question' },
          };
        return res ? ok(res) : notFound();
      }
      const conversation = this.chat.get(m[1]);
      return conversation ? ok(conversation) : notFound();
    }
    if ((m = path.match(/^\/api\/agent\/runs\/([^/]+)$/))) {
      const run = demoActivity('r-shop', iso(this.now())).find((r) => r.id === m![1]);
      if (run) return ok(demoRunDetails(run));
      const map = this.spaces.map((sp) => this.mapRun(sp)).find((r) => r?.id === m![1]);
      return map ? ok({ ...map, stepLog: [] }) : notFound();
    }
    if (method === 'GET' && path === '/api/github/installations')
      return ok([
        { id: 'i-1', githubInstallationId: '1', accountLogin: 'qorganapp', createdAt: iso(0) },
      ]);
    if (method === 'GET' && path === '/api/github/install-url')
      return ok({ url: '/repositories?installed=1' });
    if (method === 'POST' && (m = path.match(/^\/api\/github\/installations\/[^/]+\/sync$/)))
      return { status: 204, body: null };

    if ((m = path.match(/^\/api\/repositories\/([^/]+)\/scans$/))) {
      if (!this.repos.some((r) => r.id === m![1])) return notFound();
      if (method === 'POST') return { status: 202, body: this.publicScan(this.createScan(m[1])) };
      return ok(
        this.scans
          .filter((s) => s.repositoryId === m![1])
          .map((s) => this.publicScan(s))
          .reverse(),
      );
    }
    if ((m = path.match(/^\/api\/repositories\/([^/]+)\/findings$/))) {
      const status = req.params.get('status') ?? 'open';
      const latest = [...this.scans].reverse().find((s) => s.repositoryId === m![1]);
      const all = latest ? (this.findings.get(latest.id) ?? []) : [];
      return ok(page(filter(all, req.params, status)));
    }
    if ((m = path.match(/^\/api\/scans\/([^/]+)(\/summary|\/findings)?$/))) {
      const scan = this.scans.find((s) => s.id === m![1]);
      if (!scan) return notFound();
      const view = this.publicScan(scan);
      if (!m[2]) return ok(view);
      const found = view.status === 'done' ? (this.findings.get(scan.id) ?? []) : [];
      if (m[2] === '/summary') return ok(this.summary(view, found));
      return ok(page(filter(found, req.params, req.params.get('status'))));
    }
    if (method === 'PATCH' && (m = path.match(/^\/api\/findings\/([^/]+)$/))) {
      const status = (req.body as { status: 'open' | 'ignored' }).status;
      const hits = [...this.findings.values()].flat().filter((f) => f.id === m![1]);
      if (!hits.length) return notFound();
      hits.forEach((f) => (f.status = status));
      return ok(hits[0]);
    }
    return notFound();
  }

  private space(space: MockSpace, method: string, rest: string, body: unknown): MockResponse {
    let m: RegExpMatchArray | null;
    switch (rest) {
      case '':
        if (method === 'PATCH') space.name = (body as { name: string }).name.trim();
        if (method === 'DELETE') {
          this.spaces.splice(this.spaces.indexOf(space), 1);
          return { status: 204, body: null };
        }
        return ok(this.detail(space));
      case '/repositories': {
        const fresh = this.known((body as { repositoryIds: string[] }).repositoryIds).filter(
          (id) => !space.repositoryIds.includes(id),
        );
        if (fresh.length) {
          space.repositoryIds.push(...fresh);
          space.repositoriesChangedMs = this.now();
        }
        return ok(this.detail(space));
      }
      case '/overview':
        return ok(this.overview(space));
      case '/graph':
        return ok(this.graph(space));
      case '/graph/refresh':
        if (this.graph(space).status !== 'running') space.mapStartedMs = this.now();
        return { status: 202, body: this.graph(space) };
      case '/agent/conversations': {
        if (method !== 'POST') return ok(this.chat.list(space.id));
        const { content, repositoryId } = body as { content: string; repositoryId?: string | null };
        if (repositoryId && !space.repositoryIds.includes(repositoryId)) return notFound();
        return ok(this.chat.start(space.id, content, repositoryId ?? null));
      }
      case '/agent/activity': {
        const runs = space.repositoryIds.flatMap((id) => demoActivity(id, this.lastDoneAt(id)));
        const map = this.mapRun(space);
        return ok(
          [...(map ? [map] : []), ...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
      }
      case '/agent/fixes':
        return ok(space.repositoryIds.includes('r-shop') ? DEMO_FIXES : []);
    }
    if (method === 'DELETE' && (m = rest.match(/^\/repositories\/([^/]+)$/))) {
      const at = space.repositoryIds.indexOf(m[1]);
      if (at >= 0) {
        space.repositoryIds.splice(at, 1);
        space.repositoriesChangedMs = this.now();
      }
      return ok(this.detail(space));
    }
    return notFound();
  }

  private newSpace(name: string, repositoryIds: string[], at = this.now()): MockSpace {
    return {
      id: `sp-${this.spaces.length + 1}-${at}`,
      name,
      repositoryIds,
      createdMs: at,
      repositoriesChangedMs: at,
      mapStartedMs: null,
    };
  }

  private known(ids: string[]): string[] {
    return [...new Set(ids)].filter((id) => this.repos.some((r) => r.id === id));
  }

  private listItem(space: MockSpace): SpaceListItem {
    return {
      id: space.id,
      name: space.name,
      repositoriesChangedAt: iso(space.repositoriesChangedMs),
      createdAt: iso(space.createdMs),
      updatedAt: iso(space.repositoriesChangedMs),
      repositoryCount: space.repositoryIds.length,
    };
  }

  private reposOf(space: MockSpace): Repository[] {
    return this.repos.filter((r) => space.repositoryIds.includes(r.id));
  }

  private detail(space: MockSpace): SpaceDetail {
    const { repositoryCount: _count, ...item } = this.listItem(space);
    return { ...item, repositories: this.reposOf(space) };
  }

  private graph(space: MockSpace) {
    return demoGraph(
      space.id,
      this.reposOf(space),
      space.mapStartedMs,
      this.now(),
      space.mapStartedMs !== null && space.repositoriesChangedMs > space.mapStartedMs,
    );
  }

  /** Запись в журнале агента о построенной карте. */
  private mapRun(space: MockSpace): AgentRun | null {
    const graph = this.graph(space);
    if (graph.status !== 'done' || !graph.generatedAt) return null;
    return {
      id: graph.runId!,
      repositoryId: null,
      spaceId: space.id,
      kind: 'map',
      status: 'done',
      title: `Map of ${space.name}`,
      summary: graph.edges.length
        ? 'platform-infra deploys demo-shop and its public bucket; both pin a vulnerable minimist.'
        : 'No connections found between these repositories.',
      target: { relationships: graph.edges.length },
      model: 'claude-opus-5-5',
      inputTokens: 48_200,
      outputTokens: 2_100,
      steps: 14,
      error: null,
      createdAt: graph.generatedAt,
      finishedAt: graph.generatedAt,
    };
  }

  private lastDoneAt(repositoryId: string): string | null {
    const done = [...this.scans]
      .reverse()
      .find((sc) => sc.repositoryId === repositoryId && this.publicScan(sc).status === 'done');
    return done ? this.publicScan(done).finishedAt : null;
  }

  private overview(space: MockSpace): SpaceOverview {
    const zero = () =>
      Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
    const overview: SpaceOverview = {
      spaceId: space.id,
      totals: { repositories: space.repositoryIds.length, scanned: 0, open: 0 },
      bySeverity: zero(),
      byModule: {},
      repositories: [],
    };
    for (const repo of this.reposOf(space)) {
      const scans = this.scans.filter((s) => s.repositoryId === repo.id);
      const last = scans.at(-1);
      const done = [...scans].reverse().find((s) => this.publicScan(s).status === 'done');
      const open = (done ? (this.findings.get(done.id) ?? []) : []).filter(
        (f) => f.status === 'open',
      );
      const bySeverity = zero();
      for (const f of open) {
        bySeverity[f.severity]++;
        overview.bySeverity[f.severity]++;
        overview.byModule[f.module] = (overview.byModule[f.module] ?? 0) + 1;
      }
      overview.totals.open += open.length;
      if (done) overview.totals.scanned++;
      const view = last ? this.publicScan(last) : null;
      overview.repositories.push({
        repositoryId: repo.id,
        lastScan: view && {
          id: view.id,
          status: view.status,
          triageStatus: view.triageStatus ?? null,
          createdAt: view.createdAt,
          finishedAt: view.finishedAt,
        },
        open: open.length,
        bySeverity,
      });
    }
    return overview;
  }

  private auth(method: string, path: string, body: unknown): MockResponse {
    const username = (body as { username?: string })?.username ?? 'demo';
    switch (path) {
      case '/api/auth/sign-in':
      case '/api/auth/sign-up':
        this.setSession(username);
        return ok({ accessToken: 'mock-token' });
      case '/api/auth/refresh':
        return this.signedIn()
          ? ok({ accessToken: 'mock-token' })
          : { status: 401, body: { message: 'Unauthorized' } };
      case '/api/auth/me':
        return this.signedIn()
          ? ok({ id: 'u-1', username: this.session() ?? 'demo', createdAt: iso(0) })
          : { status: 401, body: { message: 'Unauthorized' } };
      case '/api/auth/logout':
        this.setSession(null);
        return { status: 204, body: null };
      default:
        return method ? notFound() : notFound();
    }
  }

  private createScan(repositoryId: string, startedMs = this.now()) {
    const scan = {
      id: `s-${this.scans.length + 1}-${repositoryId}`,
      repositoryId,
      branch: 'main',
      commitSha: null,
      modules: [...MODULES],
      status: 'queued' as const,
      trigger: 'manual' as const,
      error: null,
      startedAt: null,
      finishedAt: null,
      createdAt: iso(startedMs),
      startedMs,
    };
    this.scans.push(scan);
    this.findings.set(
      scan.id,
      applyDemoVerdicts(
        (demo.findings as Finding[]).map((f) => ({ ...f, data: { ...f.data }, status: 'open' })),
      ),
    );
    return scan;
  }

  /** Состояние скана считается от прошедшего времени — как будто его выполняет воркер. */
  private publicScan(scan: Scan & { startedMs: number }): Scan {
    const elapsed = this.now() - scan.startedMs;
    const found = this.findings.get(scan.id) ?? [];
    const moduleRuns: ModuleRun[] = MODULES.filter(
      (mod) => elapsed >= QUEUED_FOR + MODULE_DONE_AT[mod] - 900,
    ).map((mod) => ({
      id: `${scan.id}-${mod}`,
      scanId: scan.id,
      module: mod,
      status: 'done',
      durationMs: MODULE_DONE_AT[mod],
      tools: TOOLS[mod].map((tool) => ({
        tool,
        ok: true,
        findings: found.filter((f) => f.module === mod && f.tool === tool).length,
        durationMs: Math.round(MODULE_DONE_AT[mod] / TOOLS[mod].length),
      })),
    }));
    const { startedMs: _ignored, ...rest } = scan;
    const status =
      elapsed < QUEUED_FOR
        ? 'queued'
        : elapsed < QUEUED_FOR + SCAN_DURATION + TRIAGE_FOR
          ? 'running'
          : 'done';
    const triageStatus =
      status === 'done' ? 'done' : elapsed >= QUEUED_FOR + SCAN_DURATION ? 'running' : 'pending';
    return {
      ...rest,
      status,
      commitSha: status === 'done' ? '7527a31f4c0d2b9e8a1f6c3d5e7b9a0c2d4e6f81' : null,
      startedAt: status === 'queued' ? null : iso(scan.startedMs + QUEUED_FOR),
      finishedAt:
        status === 'done' ? iso(scan.startedMs + QUEUED_FOR + SCAN_DURATION + TRIAGE_FOR) : null,
      triageStatus,
      moduleRuns,
    };
  }

  private summary(scan: Scan, findings: Finding[]): ScanSummary {
    const open = findings.filter((f) => f.status === 'open');
    const openIds = new Set(open.map((f) => f.id));
    const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<
      Severity,
      number
    >;
    const byModule: Partial<Record<ScanModule, number>> = Object.fromEntries(
      MODULES.map((mod) => [mod, 0]),
    );
    for (const f of open) {
      bySeverity[f.severity]++;
      byModule[f.module] = (byModule[f.module] ?? 0) + 1;
    }
    const byId = new Map(findings.map((f) => [f.id, f]));
    const fixNow = (demo.fixNow as FixNowItem[])
      .map((item) => ({ ...item, findingIds: item.findingIds.filter((id) => openIds.has(id)) }))
      .filter((item) => item.findingIds.length > 0)
      .map((item) => {
        const verdicts = item.findingIds.map((id) => byId.get(id)?.agentVerdict).filter((x) => !!x);
        const fix = DEMO_FIXES.find((f) => f.findingIds.some((id) => item.findingIds.includes(id)));
        return {
          ...item,
          agentVerified: verdicts.some((x) => x.verdict === 'true_positive'),
          agentNote: verdicts[0]?.explanation ?? null,
          fix: fix ? { prNumber: fix.prNumber, prUrl: fix.prUrl, status: fix.status } : null,
          // Как в бэкенде: оценка агента (критичность в контексте + достижимость) меняет порядок.
          score: rescore(item.severity, verdicts[0]),
        };
      })
      .sort((a, b) => b.score - a.score);
    return {
      scanId: scan.id,
      status: scan.status,
      commitSha: scan.commitSha,
      totals: { open: open.length, fixedSinceLastScan: 0 },
      bySeverity,
      byModule,
      modules: scan.moduleRuns ?? [],
      fixNow,
      triageStatus: scan.triageStatus,
    };
  }

  private session(): string | null {
    try {
      return localStorage.getItem(AUTH_KEY);
    } catch {
      return this.memorySession;
    }
  }

  private memorySession: string | null = null;

  private setSession(username: string | null) {
    this.memorySession = username;
    try {
      if (username) localStorage.setItem(AUTH_KEY, username);
      else localStorage.removeItem(AUTH_KEY);
    } catch {
      /* приватный режим: сессия только в памяти */
    }
  }

  private signedIn(): boolean {
    return this.session() !== null;
  }
}

interface MockSpace {
  id: string;
  name: string;
  repositoryIds: string[];
  createdMs: number;
  repositoriesChangedMs: number;
  /** Когда запустили построение карты; null — карту ещё не строили. */
  mapStartedMs: number | null;
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 100,
  high: 40,
  medium: 15,
  low: 5,
  info: 1,
};

function rescore(severity: Severity, verdict?: Finding['agentVerdict']): number {
  let score = SEVERITY_WEIGHT[verdict?.severity ?? severity];
  if (verdict?.verdict === 'true_positive' && verdict.reachable === 'yes') score *= 1.5;
  if (verdict?.reachable === 'no') score *= 0.5;
  return score;
}

function repo(id: string, fullName: string, defaultBranch: string, isPrivate: boolean): Repository {
  return {
    id,
    githubRepoId: id,
    fullName,
    defaultBranch,
    private: isPrivate,
    installationId: 'i-1',
    createdAt: iso(0),
    agentTriage: true,
    agentAutoFix: true,
    agentPrReview: true,
    maxOpenAgentPrs: 3,
  };
}

function filter(findings: Finding[], params: URLSearchParams, status: string | null): Finding[] {
  const module = params.get('module');
  const severity = params.get('severity');
  return findings
    .filter((f) => (!module || f.module === module) && (!severity || f.severity === severity))
    .filter((f) => !status || f.status === status)
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

function page<T>(items: T[]): Page<T> {
  return { items, total: items.length, limit: 500, offset: 0 };
}

const ok = (body: unknown): MockResponse => ({ status: 200, body });
const notFound = (): MockResponse => ({ status: 404, body: { message: 'Not found' } });
