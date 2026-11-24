import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { FindingStatus } from '../findings/finding.entity';
import { FindingsService } from '../findings/findings.service';
import { GithubAppService } from '../github/github-app.service';
import { GitRepository } from '../repositories/git-repository.entity';
import { RepositoriesService } from '../repositories/repositories.service';
import { ScansService } from '../scans/scans.service';
import { parseGitleaks } from '../scanner/adapters/gitleaks.adapter';
import { RAW_SECRET } from '../scanner/adapters/types';
import { cloneRepository, git } from '../scanner/git';
import { runTool } from '../scanner/run-tool';
import {
  AgentConversation,
  AgentMessage,
  MessageRole,
  MessageStatus,
} from './agent-conversation.entity';
import { AgentFix } from './agent-fix.entity';
import { AgentRunKind, AgentRunStatus } from './agent-run.entity';
import { AgentRunsService } from './agent-runs.service';
import { LLM_PROVIDER, LlmProvider } from './llm/llm-provider';
import { CHAT_SYSTEM } from './prompts/chat';
import { ChatJob } from './queue/agent-jobs';
import { runAgent } from './runtime/agent-runtime';
import { Workspace } from './runtime/workspace';
import { codeReadTools } from './tools/code-tools';
import { insightTools } from './tools/insight-tools';

const HISTORY_MESSAGES = 12;

/** Ответы агента в чате — в воркере, на кешированном клоне репозитория. */
@Injectable()
export class AgentChatService {
  private readonly logger = new Logger(AgentChatService.name);
  private readonly cacheRoot = join(tmpdir(), 'qorgan-chat');
  private readonly timeoutMs: number;

  constructor(
    @Optional()
    @Inject(LLM_PROVIDER)
    private readonly provider: LlmProvider | null,
    @InjectRepository(AgentConversation)
    private readonly conversations: Repository<AgentConversation>,
    @InjectRepository(AgentMessage)
    private readonly messages: Repository<AgentMessage>,
    @InjectRepository(AgentFix) private readonly fixes: Repository<AgentFix>,
    private readonly runs: AgentRunsService,
    private readonly findings: FindingsService,
    private readonly scans: ScansService,
    private readonly repositories: RepositoriesService,
    private readonly github: GithubAppService,
    config: ConfigService,
  ) {
    this.timeoutMs = Number(config.get('SCAN_TIMEOUT_MS', 15 * 60_000));
  }

  async answer(job: ChatJob): Promise<void> {
    const reply = await this.messages.findOneBy({ id: job.messageId });
    const conversation = await this.conversations.findOne({
      where: { id: job.conversationId },
      relations: { messages: true },
      order: { messages: { createdAt: 'ASC' } },
    });
    if (!reply || !conversation || reply.status !== MessageStatus.Pending)
      return;
    const fail = (content: string) =>
      this.messages.update(reply.id, { status: MessageStatus.Failed, content });

    const repo = await this.repositories.findWithInstallation(
      conversation.repositoryId,
    );
    if (!repo) return void (await fail('Repository not found.'));
    if (!this.provider)
      return void (await fail(
        'The AI agent is not configured on this server.',
      ));
    const budget = await this.runs.remainingDailyBudget(repo.id);
    if (budget <= 0)
      return void (await fail(
        'Daily AI budget for this repository is exhausted. Try again tomorrow.',
      ));

    const question =
      [...conversation.messages]
        .reverse()
        .find((m) => m.role === MessageRole.User)?.content ?? '';
    const run = await this.runs.start(
      repo.id,
      AgentRunKind.Chat,
      `Chat: ${question.slice(0, 120)}`,
      {
        conversationId: conversation.id,
      },
    );
    try {
      const { workdir, secrets } = await this.workspaceFor(repo);
      const latest = await this.scans.latestDone(repo.id);
      const tools = [
        ...codeReadTools(new Workspace(workdir, false, secrets)),
        ...insightTools({
          latestSummary: async () =>
            latest
              ? this.findings.summary(latest)
              : { message: 'No finished scans yet' },
          findings: async (filter) => {
            if (!latest) return [];
            const page = await this.findings.listForScan(latest.id, {
              module: filter.module as never,
              severity: filter.severity as never,
              status: (filter.status as FindingStatus) ?? FindingStatus.Open,
              limit: 40,
              offset: 0,
            });
            return page.items.map((f) => ({ ...f, verdict: f.agentVerdict }));
          },
          activity: () => this.runs.listForRepository(repo.id, 25),
          fixPrs: () =>
            this.fixes.find({
              where: { repositoryId: repo.id },
              order: { createdAt: 'DESC' },
              take: 20,
            }),
        }),
      ];

      // Провайдер-нейтрально: история диалога передаётся текстом в задаче нового запуска.
      const history = conversation.messages
        .filter(
          (m) =>
            m.id !== reply.id && m.status === MessageStatus.Done && m.content,
        )
        .slice(-HISTORY_MESSAGES)
        .map(
          (m) =>
            `${m.role === MessageRole.User ? 'Teammate' : 'You'}: ${m.content}`,
        )
        .join('\n\n');
      const result = await runAgent({
        provider: this.provider,
        system: CHAT_SYSTEM,
        tools,
        task: `Repository: ${repo.fullName}\n\nConversation so far:\n\n${history}\n\nAnswer the teammate's last message.`,
        maxSteps: 20,
        tokenBudget: Math.min(budget, 300_000),
        onStep: (step) => this.runs.recordStep(run.id, step),
      });

      const content =
        result.status === 'refused'
          ? 'I can’t help with that request.'
          : result.finalText ||
            'I could not finish the answer this time. Please try rephrasing the question.';
      await this.messages.update(reply.id, {
        content,
        runId: run.id,
        status: result.finalText ? MessageStatus.Done : MessageStatus.Failed,
      });
      await this.runs.finish(run, result, {
        model: this.provider.model,
        summary: content.slice(0, 300),
      });
    } catch (e) {
      this.logger.error(`Chat failed: ${(e as Error).message}`);
      await fail('Something went wrong while preparing the answer.');
      await this.runs.finish(run, null, {
        status: AgentRunStatus.Failed,
        summary: (e as Error).message,
      });
    }
  }

  /** Кешированный клон default-ветки + значения секретов в текущем коде (для маскирования). */
  private async workspaceFor(
    repo: GitRepository,
  ): Promise<{ workdir: string; secrets: string[] }> {
    const workdir = join(this.cacheRoot, repo.id);
    const token = await this.github.installationToken(
      repo.installation.githubInstallationId,
    );
    const cloned = await access(join(workdir, '.git')).then(
      () => true,
      () => false,
    );
    if (cloned) {
      await git(workdir, ['fetch', '--quiet', 'origin', repo.defaultBranch], {
        token,
        timeoutMs: this.timeoutMs,
      });
      await git(workdir, ['reset', '--quiet', '--hard', 'FETCH_HEAD']);
      await git(workdir, ['clean', '-qfdx']);
    } else {
      await mkdir(this.cacheRoot, { recursive: true });
      await rm(workdir, { recursive: true, force: true });
      await cloneRepository({
        fullName: repo.fullName,
        branch: repo.defaultBranch,
        token,
        dir: workdir,
        timeoutMs: this.timeoutMs,
      });
    }

    const reportDir = await mkdtemp(join(tmpdir(), 'qorgan-chat-report-'));
    try {
      const report = join(reportDir, 'gitleaks.json');
      await runTool(
        'gitleaks',
        [
          'dir',
          workdir,
          '--report-format',
          'json',
          '--report-path',
          report,
          '--exit-code',
          '0',
          '--no-banner',
          '--log-level',
          'error',
        ],
        { timeoutMs: this.timeoutMs },
      );
      const secrets = parseGitleaks(workdir, await readFile(report, 'utf8'))
        .map((f) => f[RAW_SECRET])
        .filter((v): v is string => !!v);
      return { workdir, secrets };
    } catch (e) {
      // Без проверки на секреты код в модель не отдаём.
      throw new Error(`Secret pre-scan failed: ${(e as Error).message}`);
    } finally {
      await rm(reportDir, { recursive: true, force: true });
    }
  }
}
