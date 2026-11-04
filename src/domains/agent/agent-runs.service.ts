import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import {
  AgentRun,
  AgentRunKind,
  AgentRunStatus,
  AgentStep,
} from './agent-run.entity';
import { RunResult, StepRecord } from './runtime/agent-runtime';

const STATUS: Record<RunResult['status'], AgentRunStatus> = {
  done: AgentRunStatus.Done,
  failed: AgentRunStatus.Failed,
  refused: AgentRunStatus.Refused,
  budget_exceeded: AgentRunStatus.BudgetExceeded,
  max_steps: AgentRunStatus.MaxSteps,
};

@Injectable()
export class AgentRunsService {
  private readonly dailyBudget: number;

  constructor(
    @InjectRepository(AgentRun) private readonly runs: Repository<AgentRun>,
    @InjectRepository(AgentStep) private readonly steps: Repository<AgentStep>,
    config: ConfigService,
  ) {
    this.dailyBudget = Number(
      config.get('AGENT_DAILY_TOKEN_BUDGET', 3_000_000),
    );
  }

  start(
    repositoryId: string,
    kind: AgentRunKind,
    title: string,
    target: Record<string, unknown> = {},
  ) {
    return this.runs.save(
      this.runs.create({ repositoryId, kind, title, target }),
    );
  }

  async recordStep(runId: string, step: StepRecord): Promise<void> {
    await this.steps.save(
      this.steps.create({
        runId,
        index: step.index,
        text: step.text.slice(0, 20_000),
        toolCalls: step.toolCalls.map((c) => ({
          ...c,
          result: c.result.slice(0, 4_000),
        })),
      }),
    );
  }

  async finish(
    run: AgentRun,
    result: RunResult | null,
    extra: {
      summary?: string;
      target?: Record<string, unknown>;
      model?: string;
      status?: AgentRunStatus;
    } = {},
  ): Promise<AgentRun> {
    run.status =
      extra.status ?? (result ? STATUS[result.status] : AgentRunStatus.Done);
    run.summary = extra.summary ?? result?.finalText.slice(0, 4_000) ?? '';
    run.target = { ...run.target, ...extra.target };
    run.model = extra.model ?? run.model;
    run.inputTokens = result?.usage.inputTokens ?? 0;
    run.outputTokens = result?.usage.outputTokens ?? 0;
    run.steps = result?.steps ?? 0;
    run.error =
      result?.error ??
      (result?.refusalCategory ? `refused: ${result.refusalCategory}` : null);
    run.finishedAt = new Date();
    return this.runs.save(run);
  }

  /** Сколько токенов ещё можно потратить на репозиторий за последние сутки. */
  async remainingDailyBudget(repositoryId: string): Promise<number> {
    const since = new Date(Date.now() - 24 * 3600_000);
    const row = await this.runs
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.inputTokens + r.outputTokens), 0)', 'used')
      .where('r.repositoryId = :repositoryId', { repositoryId })
      .andWhere('r.createdAt > :since', { since })
      .getRawOne<{ used: string }>();
    return this.dailyBudget - Number(row?.used ?? 0);
  }

  listForRepository(repositoryId: string, limit = 50) {
    return this.runs.find({
      where: { repositoryId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getWithSteps(id: string, userId: string) {
    const run = await this.runs.findOne({
      where: { id, repository: { installation: { userId } } },
      relations: { stepLog: true },
      order: { stepLog: { index: 'ASC' } },
    });
    if (!run) throw new NotFoundException('Agent run not found');
    return run;
  }

  recentSince(repositoryId: string, since: Date) {
    return this.runs.find({
      where: { repositoryId, createdAt: MoreThan(since) },
    });
  }
}
