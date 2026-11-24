import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScanModule } from '../../common/security.types';
import { SCANS_QUEUE } from '../../config/redis.config';
import { AgentFixService } from '../agent/agent-fix.service';
import { AgentTriageService } from '../agent/agent-triage.service';
import { FindingsService } from '../findings/findings.service';
import { GithubAppService } from '../github/github-app.service';
import { ModuleRunStatus, ToolRunInfo } from '../scans/scan-module-run.entity';
import { Scan, ScanStatus } from '../scans/scan.entity';
import { ScanJobData } from '../scans/scan-job.types';
import { ScansService } from '../scans/scans.service';
import { ADAPTERS, TOOL_BINARIES } from './adapters';
import {
  NormalizedFinding,
  RAW_SECRET,
  ScanContext,
  SecretFinding,
} from './adapters/types';
import { cloneRepository } from './git';
import { toolVersion } from './run-tool';
import { SecretValidator } from './secret-validator';

@Processor(SCANS_QUEUE, {
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
})
export class ScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ScanProcessor.name);

  constructor(
    private readonly scans: ScansService,
    private readonly findings: FindingsService,
    private readonly github: GithubAppService,
    private readonly secrets: SecretValidator,
    private readonly agentTriage: AgentTriageService,
    private readonly agentFix: AgentFixService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<ScanJobData>): Promise<void> {
    const scan = await this.scans.findForWorker(job.data.scanId);
    if (!scan || scan.status !== ScanStatus.Queued) return;

    const timeoutMs = Number(this.config.get('SCAN_TIMEOUT_MS', 15 * 60_000));
    const root = await mkdtemp(join(tmpdir(), 'qorgan-'));
    const workdir = join(root, 'repo');
    const reportDir = join(root, 'reports');
    await mkdir(reportDir);

    await this.scans.markRunning(scan);
    this.logger.log(
      `Scan ${scan.id}: ${scan.repository.fullName}@${scan.branch} [${scan.modules.join(', ')}]`,
    );

    try {
      const token = await this.github.installationToken(
        scan.repository.installation.githubInstallationId,
      );
      const commitSha = await cloneRepository({
        fullName: scan.repository.fullName,
        branch: scan.branch,
        commitSha: scan.commitSha,
        token,
        dir: workdir,
        timeoutMs,
      });

      const ctx: ScanContext = { workdir, reportDir, timeoutMs };
      const perModule = await Promise.all(
        scan.modules.map((m) => this.runModule(scan, m, ctx)),
      );

      const findings = perModule.flatMap((r) => r.findings);
      const secretFindings = findings.filter(
        (f) => f.module === ScanModule.Secrets,
      );
      // Валидатор стирает сырые значения — забираем их раньше, чтобы агент видел код с маской.
      const rawSecrets = secretFindings
        .map((f) => (f as SecretFinding)[RAW_SECRET])
        .filter((v): v is string => !!v);
      await this.secrets.validate(secretFindings);
      await this.findings.recordScanResults(scan, {
        findings,
        modules: scan.modules,
        succeededTools: new Set(perModule.flatMap((r) => r.succeededTools)),
      });

      const allFailed = perModule.every(
        (r) => r.status === ModuleRunStatus.Failed,
      );
      if (!allFailed) {
        await this.agentTriage.triageScan(
          scan,
          scan.repository,
          workdir,
          rawSecrets,
        );
        const queued = await this.agentFix.planFixes(scan, scan.repository);
        if (queued)
          this.logger.log(`Scan ${scan.id}: queued ${queued} agent fix(es)`);
      }
      await this.scans.markFinished(scan, {
        status: allFailed ? ScanStatus.Failed : ScanStatus.Done,
        commitSha,
        error: allFailed ? 'All scan modules failed' : undefined,
      });
      this.logger.log(`Scan ${scan.id} finished: ${findings.length} findings`);
    } catch (e) {
      const message = (e as Error).message;
      this.logger.error(`Scan ${scan.id} failed: ${message}`);
      await this.scans.markFinished(scan, {
        status: ScanStatus.Failed,
        error: message,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  /** Инструменты модуля работают параллельно; падение одного не валит остальные. */
  private async runModule(scan: Scan, module: ScanModule, ctx: ScanContext) {
    const started = Date.now();
    const adapters = ADAPTERS[module];
    const results = await Promise.all(
      adapters.map(async (adapter) => {
        const t0 = Date.now();
        const bin = TOOL_BINARIES[adapter.tool];
        const version = bin ? await toolVersion(bin[0], bin[1]) : undefined;
        try {
          const found = await adapter.run(ctx);
          return {
            findings: found,
            info: {
              tool: adapter.tool,
              ok: true,
              version,
              findings: found.length,
              durationMs: Date.now() - t0,
            },
          };
        } catch (e) {
          this.logger.warn(
            `${adapter.tool} failed on scan ${scan.id}: ${(e as Error).message}`,
          );
          return {
            findings: [] as NormalizedFinding[],
            info: {
              tool: adapter.tool,
              ok: false,
              version,
              findings: 0,
              durationMs: Date.now() - t0,
              error: (e as Error).message.slice(0, 2000),
            },
          };
        }
      }),
    );

    const tools: ToolRunInfo[] = results.map((r) => r.info);
    const okCount = tools.filter((t) => t.ok).length;
    const status =
      okCount === tools.length
        ? ModuleRunStatus.Done
        : okCount === 0
          ? ModuleRunStatus.Failed
          : ModuleRunStatus.Partial;

    await this.scans.saveModuleRun({
      scanId: scan.id,
      module,
      status,
      tools,
      durationMs: Date.now() - started,
    });
    return {
      status,
      findings: results.flatMap((r) => r.findings),
      succeededTools: tools.filter((t) => t.ok).map((t) => t.tool),
    };
  }
}
