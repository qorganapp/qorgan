import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { ScanModule, SEVERITY_ORDER } from '../../common/security.types';
import { Finding, FindingStatus } from '../findings/finding.entity';
import { FindingsService } from '../findings/findings.service';
import { mergeDuplicates } from '../findings/merge';
import { GithubAppService } from '../github/github-app.service';
import { GitRepository } from '../repositories/git-repository.entity';
import { RepositoriesService } from '../repositories/repositories.service';
import { Scan } from '../scans/scan.entity';
import { ADAPTERS } from '../scanner/adapters';
import {
  cloneRepository,
  commitAndPush,
  workingDiffStat,
} from '../scanner/git';
import { AgentFix, AgentFixStatus } from './agent-fix.entity';
import { AgentRunKind, AgentRunStatus } from './agent-run.entity';
import { AgentRunsService } from './agent-runs.service';
import { LLM_PROVIDER, LlmProvider } from './llm/llm-provider';
import { FixJob } from './queue/agent-jobs';
import { AgentQueue } from './queue/agent-queue';
import { Workspace } from './runtime/workspace';
import { FixTarget, runFix, VerifyResult } from './skills/fix.skill';
import { updateLockfile } from './tools/lockfile';

const FIXABLE = new Set<ScanModule>([
  ScanModule.SupplyChain,
  ScanModule.CodeAudit,
  ScanModule.Infra,
]);
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const MAX_FILES = 20;
const MAX_CHANGED_LINES = 800;

@Injectable()
export class AgentFixService {
  private readonly logger = new Logger(AgentFixService.name);
  private readonly timeoutMs: number;
  private readonly maxSteps: number;

  constructor(
    @Optional()
    @Inject(LLM_PROVIDER)
    private readonly provider: LlmProvider | null,
    @InjectRepository(AgentFix) private readonly fixes: Repository<AgentFix>,
    private readonly runs: AgentRunsService,
    private readonly findings: FindingsService,
    private readonly repositories: RepositoriesService,
    private readonly github: GithubAppService,
    private readonly queue: AgentQueue,
    config: ConfigService,
  ) {
    this.timeoutMs = Number(config.get('SCAN_TIMEOUT_MS', 15 * 60_000));
    this.maxSteps = Number(config.get('AGENT_MAX_STEPS', 40));
  }

  /**
   * После триажа: ставим в очередь фиксы для пунктов «fix now», которые агент подтвердил.
   * Свободных слотов — не больше лимита открытых PR агента в репозитории.
   */
  async planFixes(scan: Scan, repo: GitRepository): Promise<number> {
    if (!this.provider || !repo.agentAutoFix) return 0;
    const slots = repo.maxOpenAgentPrs - (await this.openFixes(repo.id)).length;
    if (slots <= 0) return 0;

    const summary = await this.findings.summary(scan);
    const covered = new Set(
      (await this.openFixes(repo.id)).flatMap((f) => f.findingIds),
    );
    let queued = 0;
    for (const item of summary.fixNow) {
      if (queued >= slots) break;
      if (
        !FIXABLE.has(item.module) ||
        item.findingIds.some((id) => covered.has(id))
      )
        continue;
      const rows = await this.findings.findByIds(item.findingIds);
      if (!rows.some((f) => f.agentVerdict?.verdict === 'true_positive'))
        continue;
      await this.queue.fix({
        repositoryId: repo.id,
        findingIds: item.findingIds,
      });
      queued++;
    }
    return queued;
  }

  openFixes(repositoryId: string) {
    return this.fixes.find({
      where: { repositoryId, status: AgentFixStatus.Open },
    });
  }

  async fix(job: FixJob): Promise<void> {
    const repo = await this.repositories.findWithInstallation(job.repositoryId);
    if (!this.provider || !repo || !repo.agentAutoFix) return;

    const targets = (await this.findings.findByIds(job.findingIds)).filter(
      (f) => f.status === FindingStatus.Open,
    );
    if (!targets.length || !FIXABLE.has(targets[0].module)) return;
    const module = targets[0].module;

    const open = await this.openFixes(repo.id);
    if (
      open.some((f) => f.findingIds.some((id) => job.findingIds.includes(id)))
    )
      return;

    const title = `Fix: ${targets[0].title}`.slice(0, 200);
    const run = await this.runs.start(repo.id, AgentRunKind.Fix, title, {
      findingIds: job.findingIds,
    });
    if (open.length >= repo.maxOpenAgentPrs) {
      await this.runs.finish(run, null, {
        status: AgentRunStatus.Skipped,
        summary: 'Open agent PR limit reached',
      });
      return;
    }
    const budget = await this.runs.remainingDailyBudget(repo.id);
    if (budget <= 0) {
      await this.runs.finish(run, null, {
        status: AgentRunStatus.Skipped,
        summary: 'Daily token budget exhausted',
      });
      return;
    }

    const root = await mkdtemp(join(tmpdir(), 'qorgan-fix-'));
    const workdir = join(root, 'repo');
    const reportDir = join(root, 'reports');
    await mkdir(reportDir);
    try {
      const token = await this.github.installationToken(
        repo.installation.githubInstallationId,
      );
      await cloneRepository({
        fullName: repo.fullName,
        branch: repo.defaultBranch,
        token,
        dir: workdir,
        timeoutMs: this.timeoutMs,
      });

      const baseline = await this.findings.knownFingerprints(repo.id, module);
      const outcome = await runFix({
        provider: this.provider,
        workspace: new Workspace(workdir, true),
        targets: targets.map(toTarget),
        verify: () =>
          this.verify(module, workdir, reportDir, targets, baseline),
        updateLockfile: (manifest) => updateLockfile(workdir, manifest),
        maxSteps: this.maxSteps,
        tokenBudget: budget,
        onStep: (step) => this.runs.recordStep(run.id, step),
      });

      if (!outcome.submission) {
        await this.runs.finish(run, outcome.result, {
          model: this.provider.model,
          summary: outcome.abandoned
            ? `Did not open a PR: ${outcome.abandoned}`
            : `Could not produce a verified fix (${outcome.result.status}).`,
        });
        return;
      }

      const diff = await workingDiffStat(workdir);
      const code = diff.files.filter((f) => !LOCKFILE.test(f.path));
      const codeLines = code.reduce((n, f) => n + f.added + f.removed, 0);
      if (
        !diff.files.length ||
        code.length > MAX_FILES ||
        codeLines > MAX_CHANGED_LINES
      ) {
        await this.runs.finish(run, outcome.result, {
          status: AgentRunStatus.Failed,
          model: this.provider.model,
          summary: !diff.files.length
            ? 'The agent submitted a fix without changes.'
            : `Fix too large to open automatically (${code.length} files, ${codeLines} lines).`,
        });
        return;
      }

      const bot = this.github.botIdentity();
      const branch = `qorgan/fix-${slug(outcome.submission.title)}-${run.id.slice(0, 8)}`;
      await commitAndPush({
        dir: workdir,
        branch,
        baseBranch: repo.defaultBranch,
        message: `${outcome.submission.title}\n\n${outcome.submission.summary}`,
        authorName: bot.name,
        authorEmail: bot.email,
        token,
      });
      const pr = await this.github.asInstallation<{
        number: number;
        html_url: string;
      }>(
        repo.installation.githubInstallationId,
        `/repos/${repo.fullName}/pulls`,
        {
          method: 'POST',
          body: {
            title: outcome.submission.title,
            head: branch,
            base: repo.defaultBranch,
            body: prBody(outcome.submission.summary, targets),
            maintainer_can_modify: true,
          },
        },
      );
      await this.fixes.save(
        this.fixes.create({
          repositoryId: repo.id,
          module,
          findingIds: job.findingIds,
          title: outcome.submission.title,
          branch,
          prNumber: pr.number,
          prUrl: pr.html_url,
          runId: run.id,
        }),
      );
      await this.runs.finish(run, outcome.result, {
        model: this.provider.model,
        summary: `Opened PR #${pr.number}: ${outcome.submission.title}`,
        target: { prNumber: pr.number, prUrl: pr.html_url, branch },
      });
      this.logger.log(`${repo.fullName}: opened PR #${pr.number}`);
    } catch (e) {
      this.logger.error(
        `Fix failed for ${repo.fullName}: ${(e as Error).message}`,
      );
      await this.runs.finish(run, null, {
        status: AgentRunStatus.Failed,
        summary: (e as Error).message,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  /** Перезапуск сканеров модуля на изменённом коде. */
  private async verify(
    module: ScanModule,
    workdir: string,
    reportDir: string,
    targets: Finding[],
    baseline: Set<string>,
  ): Promise<VerifyResult> {
    try {
      const found = mergeDuplicates(
        (
          await Promise.all(
            ADAPTERS[module].map((a) =>
              a.run({ workdir, reportDir, timeoutMs: this.timeoutMs }),
            ),
          )
        ).flat(),
      );
      const now = new Set(found.map((f) => f.fingerprint));
      return {
        stillPresent: targets
          .filter((t) => now.has(t.fingerprint))
          .map((t) => t.title),
        introduced: found
          .filter((f) => !baseline.has(f.fingerprint))
          .sort(
            (a, b) =>
              SEVERITY_ORDER.indexOf(a.severity) -
              SEVERITY_ORDER.indexOf(b.severity),
          )
          .slice(0, 20)
          .map((f) => ({
            title: f.title,
            severity: f.severity,
            filePath: f.filePath,
          })),
      };
    } catch (e) {
      return { stillPresent: [], introduced: [], error: (e as Error).message };
    }
  }
}

function toTarget(f: Finding): FixTarget {
  return {
    id: f.id,
    module: f.module,
    tool: f.tool,
    ruleId: f.ruleId,
    severity: f.severity,
    title: f.title,
    description: f.description,
    filePath: f.filePath,
    line: f.line,
    data: f.data,
    fingerprint: f.fingerprint,
    verdictExplanation: f.agentVerdict?.explanation,
    fixHint: f.agentVerdict?.fixHint ?? f.action,
  };
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'security'
  );
}

export function prBody(summary: string, targets: Finding[]): string {
  const issues = targets
    .map(
      (t) =>
        `- **${t.severity.toUpperCase()}** ${t.title}${t.filePath ? ` — \`${t.filePath}${t.line ? `:${t.line}` : ''}\`` : ''}`,
    )
    .join('\n');
  return [
    summary,
    '',
    '### Issues addressed',
    issues,
    '',
    '### Verification',
    'The scanner that reported these issues was re-run on this branch: they are no longer reported, and no new high or critical findings were introduced.',
    '',
    '---',
    '_Opened automatically by the Qorgan security agent. Please review before merging — the agent never merges on its own._',
  ].join('\n');
}
