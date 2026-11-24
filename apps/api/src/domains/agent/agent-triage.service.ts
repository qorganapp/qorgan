import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Severity } from '../../common/security.types';
import { FindingsService } from '../findings/findings.service';
import { GitRepository } from '../repositories/git-repository.entity';
import { Scan, TriageStatus } from '../scans/scan.entity';
import { ScansService } from '../scans/scans.service';
import { AgentRunKind, AgentRunStatus } from './agent-run.entity';
import { AgentRunsService } from './agent-runs.service';
import { LLM_PROVIDER, LlmProvider } from './llm/llm-provider';
import { Workspace } from './runtime/workspace';
import { runTriage } from './skills/triage.skill';

/** Разбор находок агентом — выполняется в воркере, пока клон репозитория ещё на диске. */
@Injectable()
export class AgentTriageService {
  private readonly logger = new Logger(AgentTriageService.name);
  private readonly batchSize: number;
  private readonly maxSteps: number;

  constructor(
    @Optional()
    @Inject(LLM_PROVIDER)
    private readonly provider: LlmProvider | null,
    private readonly runs: AgentRunsService,
    private readonly findings: FindingsService,
    private readonly scans: ScansService,
    config: ConfigService,
  ) {
    this.batchSize = Number(config.get('AGENT_TRIAGE_BATCH', 20));
    this.maxSteps = Number(config.get('AGENT_MAX_STEPS', 40));
  }

  get enabled(): boolean {
    return !!this.provider;
  }

  async triageScan(
    scan: Scan,
    repo: GitRepository,
    workdir: string,
    secrets: string[],
  ): Promise<void> {
    if (!this.provider || !repo.agentTriage) {
      await this.scans.setTriageStatus(scan.id, TriageStatus.Skipped);
      return;
    }
    const findings = await this.findings.untriagedForScan(
      scan.id,
      this.batchSize,
    );
    if (!findings.length) {
      await this.scans.setTriageStatus(scan.id, TriageStatus.Done);
      return;
    }
    const budget = await this.runs.remainingDailyBudget(repo.id);
    const run = await this.runs.start(
      repo.id,
      AgentRunKind.Triage,
      `Triage of ${findings.length} findings`,
      {
        scanId: scan.id,
      },
    );
    if (budget <= 0) {
      await this.runs.finish(run, null, {
        status: AgentRunStatus.Skipped,
        summary: 'Daily token budget exhausted',
      });
      await this.scans.setTriageStatus(scan.id, TriageStatus.Skipped);
      return;
    }

    await this.scans.setTriageStatus(scan.id, TriageStatus.Running);
    try {
      const { result, verdicts } = await runTriage({
        provider: this.provider,
        workspace: new Workspace(workdir, false, secrets),
        findings,
        maxSteps: this.maxSteps,
        tokenBudget: budget,
        onStep: (step) => this.runs.recordStep(run.id, step),
      });

      const counts = { confirmed: 0, falsePositive: 0, ignored: 0, unsure: 0 };
      for (const finding of findings) {
        const v = verdicts.get(finding.id);
        if (!v) continue;
        const outcome = await this.findings.applyVerdict(finding, {
          verdict: v.verdict,
          reachable: v.reachable,
          severity: v.severity as Severity,
          confidence: v.confidence,
          explanation: v.explanation,
          exploitScenario: v.exploit_scenario,
          fixHint: v.fix_hint,
          runId: run.id,
          at: new Date().toISOString(),
        });
        if (v.verdict === 'true_positive') counts.confirmed++;
        if (v.verdict === 'false_positive') counts.falsePositive++;
        if (v.verdict === 'needs_context') counts.unsure++;
        if (outcome === 'ignored') counts.ignored++;
      }

      const summary =
        `Reviewed ${verdicts.size} of ${findings.length} findings: ${counts.confirmed} confirmed, ` +
        `${counts.falsePositive} false positives (${counts.ignored} auto-ignored), ${counts.unsure} need context.`;
      await this.runs.finish(run, result, {
        summary,
        model: this.provider.model,
        target: {
          scanId: scan.id,
          findingIds: [...verdicts.keys()],
          ...counts,
        },
      });
      await this.scans.setTriageStatus(
        scan.id,
        verdicts.size ? TriageStatus.Done : TriageStatus.Failed,
      );
      this.logger.log(`Scan ${scan.id}: ${summary}`);
    } catch (e) {
      this.logger.error(
        `Triage failed for scan ${scan.id}: ${(e as Error).message}`,
      );
      await this.runs.finish(run, null, {
        status: AgentRunStatus.Failed,
        summary: (e as Error).message,
      });
      await this.scans.setTriageStatus(scan.id, TriageStatus.Failed);
    }
  }
}
