import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { ALL_SCAN_MODULES, ScanModule } from '../../common/security.types';
import { SCANS_QUEUE } from '../../config/redis.config';
import { GitRepository } from '../repositories/git-repository.entity';
import { ScanModuleRun } from './scan-module-run.entity';
import { Scan, ScanStatus, ScanTrigger } from './scan.entity';
import { ScanJobData } from './scan-job.types';

@Injectable()
export class ScansService {
  constructor(
    @InjectRepository(Scan) private readonly scans: Repository<Scan>,
    @InjectRepository(ScanModuleRun)
    private readonly runs: Repository<ScanModuleRun>,
    @InjectQueue(SCANS_QUEUE) private readonly queue: Queue<ScanJobData>,
  ) {}

  /**
   * Ставит скан в очередь. Если по этой ветке уже есть скан в очереди — переиспользуем его
   * (серия push-ей подряд не должна порождать серию сканов).
   */
  async enqueue(
    repo: GitRepository,
    opts: { trigger: ScanTrigger; modules?: ScanModule[]; commitSha?: string },
  ): Promise<Scan> {
    const modules = opts.modules?.length ? opts.modules : ALL_SCAN_MODULES;
    const queued = await this.scans.findOne({
      where: {
        repositoryId: repo.id,
        branch: repo.defaultBranch,
        status: ScanStatus.Queued,
      },
    });
    if (queued) {
      queued.modules = [...new Set([...queued.modules, ...modules])];
      if (opts.commitSha) queued.commitSha = opts.commitSha;
      return this.scans.save(queued);
    }

    const scan = await this.scans.save(
      this.scans.create({
        repositoryId: repo.id,
        branch: repo.defaultBranch,
        commitSha: opts.commitSha ?? null,
        modules,
        trigger: opts.trigger,
        status: ScanStatus.Queued,
      }),
    );
    await this.queue.add(
      'scan',
      { scanId: scan.id },
      {
        jobId: scan.id,
        attempts: 1,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
    return scan;
  }

  async findOwned(id: string, userId: string): Promise<Scan> {
    const scan = await this.scans.findOne({
      where: { id, repository: { installation: { userId } } },
      relations: { moduleRuns: true },
    });
    if (!scan) throw new NotFoundException('Scan not found');
    return scan;
  }

  listForRepository(repositoryId: string, limit = 50): Promise<Scan[]> {
    return this.scans.find({
      where: { repositoryId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  findForWorker(id: string): Promise<Scan | null> {
    return this.scans.findOne({
      where: { id },
      relations: { repository: { installation: true } },
    });
  }

  async markRunning(scan: Scan): Promise<void> {
    scan.status = ScanStatus.Running;
    scan.startedAt = new Date();
    await this.scans.update(scan.id, {
      status: scan.status,
      startedAt: scan.startedAt,
    });
  }

  async markFinished(
    scan: Scan,
    result: {
      status: ScanStatus.Done | ScanStatus.Failed;
      commitSha?: string;
      error?: string;
    },
  ): Promise<void> {
    await this.scans.update(scan.id, {
      status: result.status,
      commitSha: result.commitSha ?? scan.commitSha,
      error: result.error ?? null,
      finishedAt: new Date(),
    });
  }

  async saveModuleRun(run: Omit<ScanModuleRun, 'id' | 'scan'>): Promise<void> {
    await this.runs.upsert(run, ['scanId', 'module']);
  }
}
