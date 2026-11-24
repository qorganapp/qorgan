import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  buildEdges,
  buildNodes,
  GraphInput,
} from '../spaces/graph/build-edges';
import { extractManifest } from '../spaces/graph/manifest-extract';
import { SpaceGraphService } from '../spaces/space-graph.service';
import { SpacesService } from '../spaces/spaces.service';
import { AgentRunKind, AgentRunStatus } from './agent-run.entity';
import { AgentRunsService } from './agent-runs.service';
import { LLM_PROVIDER, LlmProvider } from './llm/llm-provider';
import { MapJob } from './queue/agent-jobs';
import { RepoCheckoutService } from './runtime/repo-checkout.service';
import { Workspace } from './runtime/workspace';
import { runMap } from './skills/map.skill';
import { spaceTools } from './tools/space-tools';

/** Строит карту связей пространства: манифесты (без модели) + поиск вызовов между сервисами агентом. */
@Injectable()
export class AgentMapService {
  private readonly logger = new Logger(AgentMapService.name);

  constructor(
    @Optional()
    @Inject(LLM_PROVIDER)
    private readonly provider: LlmProvider | null,
    private readonly runs: AgentRunsService,
    private readonly spaces: SpacesService,
    private readonly graphs: SpaceGraphService,
    private readonly checkouts: RepoCheckoutService,
  ) {}

  async build(job: MapJob): Promise<void> {
    const space = await this.spaces.findById(job.spaceId);
    if (!space) return;
    // Состав репозиториев фиксируем на этот момент: изменится позже — карта станет устаревшей.
    const at = new Date();
    const repos = await this.spaces.repositoriesOf(space.id, true);
    const byId = new Map(repos.map((r) => [r.id, r]));

    try {
      const vulnerable = await this.spaces.vulnerablePackages([...byId.keys()]);
      const inputs: GraphInput[] = [];
      for (const repo of repos) {
        // По одному клону за раз: манифесты читаются быстро, диск не забиваем.
        const session = this.checkouts.session();
        try {
          const { workdir } = await session.get(repo);
          inputs.push({
            repositoryId: repo.id,
            fullName: repo.fullName,
            manifest: await extractManifest(workdir),
            vulnerable: vulnerable.get(repo.id),
          });
        } finally {
          session.close();
        }
      }
      const nodes = buildNodes(inputs);
      const edges = buildEdges(inputs);

      const budget = await this.runs.remainingSpaceBudget(space.id);
      if (!this.provider || repos.length < 2 || budget <= 0) {
        await this.graphs.complete(space.id, { nodes, edges, runId: null, at });
        return;
      }

      const run = await this.runs.start(
        { spaceId: space.id },
        AgentRunKind.Map,
        `Map of ${space.name}`.slice(0, 200),
        { repositories: repos.length },
      );
      const session = this.checkouts.session();
      try {
        const outcome = await runMap({
          provider: this.provider,
          repos,
          known: edges,
          tools: spaceTools({
            repos,
            workspace: async (repo) => {
              const { workdir, secrets } = await session.get(
                byId.get(repo.id)!,
              );
              return new Workspace(workdir, false, secrets);
            },
          }),
          tokenBudget: Math.min(budget, 600_000),
          onStep: (step) => this.runs.recordStep(run.id, step),
        });
        // Найденное до обрыва по бюджету или шагам тоже сохраняем: связи подтверждены кодом.
        await this.graphs.complete(space.id, {
          nodes,
          edges: [...edges, ...outcome.edges],
          runId: run.id,
          at,
        });
        await this.runs.finish(run, outcome.result, {
          model: this.provider.model,
          summary:
            outcome.summary ||
            `Found ${outcome.edges.length} runtime relationships.`,
          target: { relationships: edges.length + outcome.edges.length },
        });
      } catch (e) {
        await this.runs.finish(run, null, {
          status: AgentRunStatus.Failed,
          summary: (e as Error).message,
        });
        // Связи по манифестам уже есть — показываем их, а не ошибку.
        await this.graphs.complete(space.id, {
          nodes,
          edges,
          runId: run.id,
          at,
        });
        this.logger.error(`Map agent failed: ${(e as Error).message}`);
      } finally {
        session.close();
      }
    } catch (e) {
      this.logger.error(`Map failed: ${(e as Error).message}`);
      await this.graphs.fail(
        space.id,
        'Could not read the repositories of this space.',
      );
    }
  }
}
