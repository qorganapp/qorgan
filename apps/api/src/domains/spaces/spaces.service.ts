import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ScanModule,
  SEVERITY_ORDER,
  Severity,
} from '../../common/security.types';
import { Finding, FindingStatus } from '../findings/finding.entity';
import { GitRepository } from '../repositories/git-repository.entity';
import { RepositoriesService } from '../repositories/repositories.service';
import { Scan, ScanStatus, TriageStatus } from '../scans/scan.entity';
import { packageKey } from './graph/manifest-extract';
import { SpaceRepository } from './space-repository.entity';
import { Space } from './space.entity';

export interface SpaceListItem extends Space {
  repositoryCount: number;
}

export interface SpaceDetail extends Space {
  repositories: GitRepository[];
}

export interface SpaceRepositoryOverview {
  repositoryId: string;
  lastScan: {
    id: string;
    status: ScanStatus;
    triageStatus: TriageStatus | null;
    createdAt: Date;
    finishedAt: Date | null;
  } | null;
  open: number;
  bySeverity: Record<Severity, number>;
}

export interface SpaceOverview {
  spaceId: string;
  totals: { repositories: number; scanned: number; open: number };
  bySeverity: Record<Severity, number>;
  byModule: Partial<Record<ScanModule, number>>;
  repositories: SpaceRepositoryOverview[];
}

const emptySeverities = (): Record<Severity, number> =>
  Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<
    Severity,
    number
  >;

@Injectable()
export class SpacesService {
  constructor(
    @InjectRepository(Space) private readonly spaces: Repository<Space>,
    @InjectRepository(SpaceRepository)
    private readonly links: Repository<SpaceRepository>,
    @InjectRepository(Finding) private readonly findings: Repository<Finding>,
    @InjectRepository(Scan) private readonly scans: Repository<Scan>,
    private readonly repositories: RepositoriesService,
  ) {}

  async listOwned(userId: string): Promise<SpaceListItem[]> {
    const spaces = await this.spaces.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    if (!spaces.length) return [];
    const counts = await this.links
      .createQueryBuilder('l')
      .select('l.spaceId', 'spaceId')
      .addSelect('COUNT(*)::int', 'count')
      .where('l.spaceId IN (:...ids)', { ids: spaces.map((s) => s.id) })
      .groupBy('l.spaceId')
      .getRawMany<{ spaceId: string; count: number }>();
    const bySpace = new Map(counts.map((c) => [c.spaceId, c.count]));
    return spaces.map((s) => ({
      ...s,
      repositoryCount: bySpace.get(s.id) ?? 0,
    }));
  }

  async findOwned(id: string, userId: string): Promise<Space> {
    const space = await this.spaces.findOne({ where: { id, userId } });
    // 404, а не 403: не раскрываем, что чужое пространство существует.
    if (!space) throw new NotFoundException('Space not found');
    return space;
  }

  /** Без проверки владельца — для воркера. */
  findById(id: string): Promise<Space | null> {
    return this.spaces.findOne({ where: { id } });
  }

  async detail(id: string, userId: string): Promise<SpaceDetail> {
    const space = await this.findOwned(id, userId);
    return { ...space, repositories: await this.repositoriesOf(space.id) };
  }

  /** Репозитории пространства; `withInstallation` нужен воркеру для токена. */
  async repositoriesOf(
    spaceId: string,
    withInstallation = false,
  ): Promise<GitRepository[]> {
    const links = await this.links.find({
      where: { spaceId },
      relations: {
        repository: withInstallation ? { installation: true } : true,
      },
    });
    return links
      .map((l) => l.repository)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async contains(spaceId: string, repositoryId: string): Promise<boolean> {
    return (await this.links.countBy({ spaceId, repositoryId })) > 0;
  }

  async create(
    userId: string,
    name: string,
    repositoryIds: string[] = [],
  ): Promise<SpaceDetail> {
    const owned = await this.repositories.findManyOwned(repositoryIds, userId);
    const space = await this.spaces.save(this.spaces.create({ userId, name }));
    await this.link(space.id, owned);
    return this.detail(space.id, userId);
  }

  async rename(id: string, userId: string, name: string): Promise<SpaceDetail> {
    const space = await this.findOwned(id, userId);
    await this.spaces.update(space.id, { name });
    return this.detail(space.id, userId);
  }

  async remove(id: string, userId: string): Promise<void> {
    const space = await this.findOwned(id, userId);
    await this.spaces.delete(space.id);
  }

  /** Идемпотентно: уже добавленные репозитории пропускаются. */
  async addRepositories(
    id: string,
    userId: string,
    repositoryIds: string[],
  ): Promise<SpaceDetail> {
    const space = await this.findOwned(id, userId);
    const owned = await this.repositories.findManyOwned(repositoryIds, userId);
    await this.link(space.id, owned);
    return this.detail(space.id, userId);
  }

  async removeRepository(
    id: string,
    userId: string,
    repositoryId: string,
  ): Promise<SpaceDetail> {
    const space = await this.findOwned(id, userId);
    const res = await this.links.delete({ spaceId: space.id, repositoryId });
    if (res.affected) await this.touchRepositories(space.id);
    return this.detail(space.id, userId);
  }

  async overview(id: string, userId: string): Promise<SpaceOverview> {
    const space = await this.findOwned(id, userId);
    const repos = await this.repositoriesOf(space.id);
    const ids = repos.map((r) => r.id);

    const overview: SpaceOverview = {
      spaceId: space.id,
      totals: { repositories: repos.length, scanned: 0, open: 0 },
      bySeverity: emptySeverities(),
      byModule: {},
      repositories: repos.map((r) => ({
        repositoryId: r.id,
        lastScan: null,
        open: 0,
        bySeverity: emptySeverities(),
      })),
    };
    if (!ids.length) return overview;
    const byRepo = new Map(
      overview.repositories.map((r) => [r.repositoryId, r]),
    );

    const counts = await this.findings
      .createQueryBuilder('f')
      .select('f.repositoryId', 'repositoryId')
      .addSelect('f.severity', 'severity')
      .addSelect('f.module', 'module')
      .addSelect('COUNT(*)::int', 'count')
      .where('f.repositoryId IN (:...ids)', { ids })
      .andWhere('f.status = :status', { status: FindingStatus.Open })
      .groupBy('f.repositoryId')
      .addGroupBy('f.severity')
      .addGroupBy('f.module')
      .getRawMany<{
        repositoryId: string;
        severity: Severity;
        module: ScanModule;
        count: number;
      }>();
    for (const c of counts) {
      const repo = byRepo.get(c.repositoryId);
      if (!repo) continue;
      repo.open += c.count;
      repo.bySeverity[c.severity] += c.count;
      overview.totals.open += c.count;
      overview.bySeverity[c.severity] += c.count;
      overview.byModule[c.module] =
        (overview.byModule[c.module] ?? 0) + c.count;
    }

    const lastScans = await this.scans
      .createQueryBuilder('s')
      .distinctOn(['s.repositoryId'])
      .where('s.repositoryId IN (:...ids)', { ids })
      .orderBy('s.repositoryId')
      .addOrderBy('s.createdAt', 'DESC')
      .getMany();
    for (const s of lastScans) {
      const repo = byRepo.get(s.repositoryId);
      if (!repo) continue;
      repo.lastScan = {
        id: s.id,
        status: s.status,
        triageStatus: s.triageStatus,
        createdAt: s.createdAt,
        finishedAt: s.finishedAt,
      };
    }
    overview.totals.scanned = await this.scans
      .createQueryBuilder('s')
      .select('COUNT(DISTINCT s.repositoryId)::int', 'count')
      .where('s.repositoryId IN (:...ids)', { ids })
      .andWhere('s.status = :status', { status: ScanStatus.Done })
      .getRawOne<{ count: number }>()
      .then((r) => r?.count ?? 0);

    return overview;
  }

  /** Пакеты с открытыми находками Supply Chain по репозиториям: ключи `ecosystem:name`. */
  async vulnerablePackages(
    repositoryIds: string[],
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (!repositoryIds.length) return out;
    const rows = await this.findings
      .createQueryBuilder('f')
      .select('f.repositoryId', 'repositoryId')
      .addSelect(`f.data->>'package'`, 'name')
      .addSelect(`f.data->>'ecosystem'`, 'ecosystem')
      .where('f.repositoryId IN (:...ids)', { ids: repositoryIds })
      .andWhere('f.module = :module', { module: ScanModule.SupplyChain })
      .andWhere('f.status = :status', { status: FindingStatus.Open })
      .andWhere(`f.data->>'package' IS NOT NULL`)
      .distinct(true)
      .getRawMany<{
        repositoryId: string;
        name: string;
        ecosystem: string | null;
      }>();
    for (const row of rows) {
      const ecosystem =
        row.ecosystem?.toLowerCase() === 'pypi' ? 'pypi' : 'npm';
      const keys = out.get(row.repositoryId) ?? new Set<string>();
      keys.add(packageKey({ name: row.name, ecosystem }));
      out.set(row.repositoryId, keys);
    }
    return out;
  }

  private async link(spaceId: string, repos: GitRepository[]): Promise<void> {
    if (!repos.length) return;
    const existing = await this.links.find({
      where: { spaceId, repositoryId: In(repos.map((r) => r.id)) },
      select: { repositoryId: true },
    });
    const have = new Set(existing.map((l) => l.repositoryId));
    const fresh = repos.filter((r) => !have.has(r.id));
    if (!fresh.length) return;
    await this.links.insert(
      fresh.map((r) => ({ spaceId, repositoryId: r.id })),
    );
    await this.touchRepositories(spaceId);
  }

  private async touchRepositories(spaceId: string): Promise<void> {
    await this.spaces.update(spaceId, { repositoriesChangedAt: new Date() });
  }
}
