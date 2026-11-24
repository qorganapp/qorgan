import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FindingStatus } from '../findings/finding.entity';
import { FindingsService } from '../findings/findings.service';
import { ScansService } from '../scans/scans.service';
import { SpaceGraphService } from '../spaces/space-graph.service';
import { SpacesService } from '../spaces/spaces.service';
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
import { SPACE_CHAT_SYSTEM } from './prompts/chat';
import { ChatJob } from './queue/agent-jobs';
import { runAgent } from './runtime/agent-runtime';
import { RepoCheckoutService } from './runtime/repo-checkout.service';
import { Workspace } from './runtime/workspace';
import { InsightSource } from './tools/insight-tools';
import { spaceMapTool, SpaceRepo, spaceTools } from './tools/space-tools';

const HISTORY_MESSAGES = 12;

/** Ответы агента пространства в чате — в воркере, на кешированных клонах его репозиториев. */
@Injectable()
export class AgentChatService {
  private readonly logger = new Logger(AgentChatService.name);

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
    private readonly spaces: SpacesService,
    private readonly graphs: SpaceGraphService,
    private readonly checkouts: RepoCheckoutService,
  ) {}

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

    const space = conversation.spaceId
      ? await this.spaces.findById(conversation.spaceId)
      : null;
    if (!space) return void (await fail('Space not found.'));
    if (!this.provider)
      return void (await fail(
        'The AI agent is not configured on this server.',
      ));
    const budget = await this.runs.remainingSpaceBudget(space.id);
    if (budget <= 0)
      return void (await fail(
        'Daily AI budget for this space is exhausted. Try again tomorrow.',
      ));

    const repos = await this.spaces.repositoriesOf(space.id, true);
    const byId = new Map(repos.map((r) => [r.id, r]));
    const focus = conversation.repositoryId
      ? (byId.get(conversation.repositoryId) ?? null)
      : null;

    const question =
      [...conversation.messages]
        .reverse()
        .find((m) => m.role === MessageRole.User)?.content ?? '';
    const run = await this.runs.start(
      { spaceId: space.id, repositoryId: focus?.id },
      AgentRunKind.Chat,
      `Chat: ${question.slice(0, 120)}`,
      {
        conversationId: conversation.id,
      },
    );
    const session = this.checkouts.session();
    try {
      const tools = [
        ...spaceTools({
          repos,
          workspace: async (repo) => {
            const { workdir, secrets } = await session.get(byId.get(repo.id)!);
            return new Workspace(workdir, false, secrets);
          },
          insight: (repo) => this.insightFor(repo),
        }),
        spaceMapTool(async () => {
          const graph = await this.graphs.view(space);
          const name = (id: string) =>
            byId.get(id)?.fullName ?? 'removed repository';
          return {
            status: graph.status,
            stale: graph.stale,
            edges: graph.edges.map((e) => ({
              ...e,
              from: name(e.from),
              to: name(e.to),
            })),
          };
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
      const task = [
        `Space: ${space.name}`,
        repos.length
          ? `Repositories in the space:\n${repos.map((r) => `- ${r.fullName}`).join('\n')}`
          : 'The space has no repositories yet.',
        focus
          ? `The teammate is asking about the repository ${focus.fullName}.`
          : 'The teammate is asking about the space as a whole.',
        `Conversation so far:\n\n${history}`,
        "Answer the teammate's last message.",
      ].join('\n\n');
      const result = await runAgent({
        provider: this.provider,
        system: SPACE_CHAT_SYSTEM,
        tools,
        task,
        maxSteps: 30,
        tokenBudget: Math.min(budget, 400_000),
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
    } finally {
      session.close();
    }
  }

  /** Результаты сканов, вердикты и действия агента по одному репозиторию пространства. */
  private insightFor(repo: SpaceRepo): InsightSource {
    const latest = this.scans.latestDone(repo.id);
    return {
      latestSummary: async () => {
        const scan = await latest;
        return scan
          ? this.findings.summary(scan)
          : { message: 'No finished scans yet' };
      },
      findings: async (filter) => {
        const scan = await latest;
        if (!scan) return [];
        const page = await this.findings.listForScan(scan.id, {
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
    };
  }
}
