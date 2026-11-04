import {
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
} from '../api/api.types';
import demo from './demo-scan.json';

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

  constructor(private readonly now: () => number = Date.now) {
    // У первого репозитория уже есть вчерашний скан — сразу видно экран результатов.
    const yesterday = this.now() - 26 * 3600_000;
    this.createScan('r-shop', yesterday);
  }

  handle(req: MockRequest): MockResponse {
    const { method, url } = req;
    const path = url.replace(/\?.*$/, '');
    let m: RegExpMatchArray | null;

    if (path.startsWith('/api/auth/')) return this.auth(method, path, req.body);
    if (!this.signedIn()) return { status: 401, body: { message: 'Unauthorized' } };

    if (method === 'GET' && path === '/api/repositories') return ok(this.repos);
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
      (demo.findings as Finding[]).map((f) => ({ ...f, data: { ...f.data }, status: 'open' })),
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
      elapsed < QUEUED_FOR ? 'queued' : elapsed < QUEUED_FOR + SCAN_DURATION ? 'running' : 'done';
    return {
      ...rest,
      status,
      commitSha: status === 'done' ? '7527a31f4c0d2b9e8a1f6c3d5e7b9a0c2d4e6f81' : null,
      startedAt: status === 'queued' ? null : iso(scan.startedMs + QUEUED_FOR),
      finishedAt: status === 'done' ? iso(scan.startedMs + QUEUED_FOR + SCAN_DURATION) : null,
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
    const fixNow = (demo.fixNow as FixNowItem[])
      .map((item) => ({ ...item, findingIds: item.findingIds.filter((id) => openIds.has(id)) }))
      .filter((item) => item.findingIds.length > 0);
    return {
      scanId: scan.id,
      status: scan.status,
      commitSha: scan.commitSha,
      totals: { open: open.length, fixedSinceLastScan: 0 },
      bySeverity,
      byModule,
      modules: scan.moduleRuns ?? [],
      fixNow,
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

function repo(id: string, fullName: string, defaultBranch: string, isPrivate: boolean): Repository {
  return {
    id,
    githubRepoId: id,
    fullName,
    defaultBranch,
    private: isPrivate,
    installationId: 'i-1',
    createdAt: iso(0),
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
