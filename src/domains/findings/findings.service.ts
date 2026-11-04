import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import {
  ScanModule,
  SEVERITY_ORDER,
  Severity,
} from '../../common/security.types';
import { NormalizedFinding } from '../scanner/adapters/types';
import { priorityScore } from '../triage/priority';
import { buildFixNow, FixNowItem } from '../triage/summary';
import { AgentFix } from '../agent/agent-fix.entity';
import { Scan } from '../scans/scan.entity';
import { ListFindingsQuery } from './dto/list-findings.query';
import { AgentVerdict, Finding, FindingStatus } from './finding.entity';
import { mergeDuplicates } from './merge';

export interface ScanResults {
  findings: NormalizedFinding[];
  /** Модули, которые запускались в этом скане. */
  modules: ScanModule[];
  /** Инструменты, отработавшие без ошибок: только их «пропавшие» находки считаем исправленными. */
  succeededTools: Set<string>;
}

@Injectable()
export class FindingsService {
  constructor(
    @InjectRepository(Finding) private readonly findings: Repository<Finding>,
    @InjectRepository(AgentFix)
    private readonly agentFixes: Repository<AgentFix>,
    private readonly dataSource: DataSource,
  ) {}

  /** Сохраняет результат скана: новые, повторные (reopen), исчезнувшие (fixed). */
  async recordScanResults(scan: Scan, results: ScanResults): Promise<void> {
    const incoming = mergeDuplicates(results.findings);

    await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(Finding);
      const existing = await repo.find({
        where: { repositoryId: scan.repositoryId, module: In(results.modules) },
        select: {
          id: true,
          fingerprint: true,
          status: true,
          tool: true,
          firstSeenScanId: true,
          agentVerdict: true,
        },
      });
      const byFp = new Map(existing.map((f) => [f.fingerprint, f]));
      const seen = new Set<string>();

      const rows = incoming.map((f) => {
        seen.add(f.fingerprint);
        const prev = byFp.get(f.fingerprint);
        return repo.create({
          ...f,
          id: prev?.id,
          repositoryId: scan.repositoryId,
          // Вердикт агента привязан к fingerprint и переживает повторные сканы.
          priorityScore: priorityScore({
            ...f,
            agentVerdict: prev?.agentVerdict,
          }),
          // Игнор пользователя переживает повторные сканы; исправленное снова открываем.
          status:
            prev?.status === FindingStatus.Ignored
              ? FindingStatus.Ignored
              : FindingStatus.Open,
          firstSeenScanId: prev?.firstSeenScanId ?? scan.id,
          lastSeenScanId: scan.id,
          fixedInScanId: null,
        });
      });
      await repo.save(rows, { chunk: 200 });

      const fixedIds = existing
        .filter(
          (f) =>
            f.status === FindingStatus.Open &&
            !seen.has(f.fingerprint) &&
            results.succeededTools.has(f.tool),
        )
        .map((f) => f.id);
      if (fixedIds.length) {
        await repo.update(
          { id: In(fixedIds) },
          { status: FindingStatus.Fixed, fixedInScanId: scan.id },
        );
      }
    });
  }

  findByIds(ids: string[]): Promise<Finding[]> {
    return ids.length
      ? this.findings.find({ where: { id: In(ids) } })
      : Promise.resolve([]);
  }

  /** Fingerprints находок модуля, известных до изменений агента (для поиска «новых» проблем). */
  async knownFingerprints(
    repositoryId: string,
    module: ScanModule,
  ): Promise<Set<string>> {
    const rows = await this.findings.find({
      where: { repositoryId, module },
      select: { fingerprint: true },
    });
    return new Set(rows.map((r) => r.fingerprint));
  }

  /** Открытые находки скана без вердикта агента — самые важные первыми. */
  untriagedForScan(scanId: string, limit: number): Promise<Finding[]> {
    return this.findings
      .createQueryBuilder('f')
      .where('f.lastSeenScanId = :scanId', { scanId })
      .andWhere('f.status = :status', { status: FindingStatus.Open })
      .andWhere('f.agentVerdict IS NULL')
      .orderBy('f.priorityScore', 'DESC')
      .take(limit)
      .getMany();
  }

  /**
   * Сохраняет вердикт агента и пересчитывает приоритет. Уверенное «ложное срабатывание»
   * скрывается автоматически (обратимо из UI) — это и есть автономия агента.
   */
  async applyVerdict(
    finding: Finding,
    verdict: AgentVerdict,
  ): Promise<'ignored' | 'kept'> {
    finding.agentVerdict = verdict;
    finding.priorityScore = priorityScore(finding);
    let outcome: 'ignored' | 'kept' = 'kept';
    if (
      verdict.verdict === 'false_positive' &&
      verdict.confidence === 'high' &&
      finding.status === FindingStatus.Open
    ) {
      finding.status = FindingStatus.Ignored;
      finding.statusReason = 'Auto-ignored by Qorgan agent: false positive';
      outcome = 'ignored';
    }
    await this.findings.update(finding.id, {
      agentVerdict: verdict,
      priorityScore: finding.priorityScore,
      status: finding.status,
      statusReason: finding.statusReason,
    });
    return outcome;
  }

  listForScan(scanId: string, q: ListFindingsQuery) {
    return this.list({ lastSeenScanId: scanId }, q);
  }

  listForRepository(repositoryId: string, q: ListFindingsQuery) {
    return this.list(
      { repositoryId },
      { ...q, status: q.status ?? FindingStatus.Open },
    );
  }

  async updateStatus(
    id: string,
    userId: string,
    status: FindingStatus.Open | FindingStatus.Ignored,
  ): Promise<Finding> {
    const finding = await this.findings.findOne({
      where: { id, repository: { installation: { userId } } },
    });
    if (!finding) throw new NotFoundException('Finding not found');
    finding.status = status;
    finding.statusReason =
      status === FindingStatus.Ignored ? 'Ignored by a team member' : null;
    return this.findings.save(finding);
  }

  /** Full Sweep: сводка по модулям/критичности + топ «исправить сейчас». */
  async summary(scan: Scan) {
    const open = await this.findings.find({
      where: { lastSeenScanId: scan.id, status: FindingStatus.Open },
      select: {
        id: true,
        module: true,
        severity: true,
        title: true,
        action: true,
        filePath: true,
        line: true,
        priorityScore: true,
        data: true,
        agentVerdict: true,
      },
    });
    const fixed = await this.findings.count({
      where: { fixedInScanId: scan.id },
    });

    const bySeverity = Object.fromEntries(
      SEVERITY_ORDER.map((s) => [s, 0]),
    ) as Record<Severity, number>;
    const byModule = Object.fromEntries(
      scan.modules.map((m) => [m, 0]),
    ) as Record<string, number>;
    for (const f of open) {
      bySeverity[f.severity]++;
      byModule[f.module] = (byModule[f.module] ?? 0) + 1;
    }

    return {
      scanId: scan.id,
      status: scan.status,
      commitSha: scan.commitSha,
      totals: { open: open.length, fixedSinceLastScan: fixed },
      bySeverity,
      byModule,
      modules: scan.moduleRuns ?? [],
      fixNow: await this.enrichFixNow(
        buildFixNow(open),
        open,
        scan.repositoryId,
      ),
      triageStatus: scan.triageStatus,
    };
  }

  /** Подтвердил ли пункт агент и открыт ли уже PR с исправлением. */
  private async enrichFixNow(
    items: FixNowItem[],
    open: Finding[],
    repositoryId: string,
  ) {
    const byId = new Map(open.map((f) => [f.id, f]));
    const fixes = await this.agentFixes.find({
      where: { repositoryId },
      order: { createdAt: 'DESC' },
    });
    return items.map((item) => {
      const verdicts = item.findingIds
        .map((id) => byId.get(id)?.agentVerdict)
        .filter(Boolean);
      const fix = fixes.find((f) =>
        f.findingIds.some((id) => item.findingIds.includes(id)),
      );
      return {
        ...item,
        agentVerified: verdicts.some((v) => v!.verdict === 'true_positive'),
        agentNote: verdicts[0]?.explanation ?? null,
        fix: fix
          ? { prNumber: fix.prNumber, prUrl: fix.prUrl, status: fix.status }
          : null,
      };
    });
  }

  private async list(where: FindOptionsWhere<Finding>, q: ListFindingsQuery) {
    const filter: FindOptionsWhere<Finding> = {
      ...where,
      ...(q.module && { module: q.module }),
      ...(q.severity && { severity: q.severity }),
      ...(q.status && { status: q.status }),
    };
    const [items, total] = await this.findings.findAndCount({
      where: filter,
      order: { priorityScore: 'DESC', createdAt: 'ASC' },
      take: q.limit,
      skip: q.offset,
    });
    return { items, total, limit: q.limit, offset: q.offset };
  }
}
