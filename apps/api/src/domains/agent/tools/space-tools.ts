import { z } from 'zod';
import { AgentTool, defineTool, ToolInputError } from '../runtime/agent-tool';
import { Workspace } from '../runtime/workspace';
import { codeReadTools } from './code-tools';
import { InsightSource, insightTools } from './insight-tools';

export interface SpaceRepo {
  id: string;
  /** owner/name — так модель называет репозиторий в аргументе `repo`. */
  fullName: string;
  defaultBranch: string;
}

export interface SpaceToolsSource {
  repos: SpaceRepo[];
  /** Клон репозитория; вызывается лениво, при первом обращении агента к его коду. */
  workspace(repo: SpaceRepo): Promise<Workspace>;
  /** Сканы, вердикты и активность по репозиторию. Не задан — только чтение кода. */
  insight?(repo: SpaceRepo): InsightSource;
}

// Шаблоны нужны только ради имён, описаний и схем: их `run` не вызывается.
const CODE_TEMPLATES = codeReadTools(new Workspace('/'));
const INSIGHT_TEMPLATES = insightTools({} as InsightSource);

/**
 * Инструменты агента пространства: те же чтение кода и результаты сканов,
 * но каждый вызов адресован одному репозиторию пространства через `repo`.
 * Имя репозитория — вывод модели: принимаются только репозитории пространства.
 */
export function spaceTools(src: SpaceToolsSource): AgentTool[] {
  const byName = new Map(src.repos.map((r) => [r.fullName.toLowerCase(), r]));
  const names = src.repos.map((r) => r.fullName).join(', ') || '(none)';

  const resolve = (name: string): SpaceRepo => {
    const repo = byName.get(name.trim().toLowerCase());
    if (!repo)
      throw new ToolInputError(
        `Repository "${name}" is not in this space. Repositories in the space: ${names}`,
      );
    return repo;
  };

  const scoped = (
    template: AgentTool,
    tools: (repo: SpaceRepo) => Promise<AgentTool[]> | AgentTool[],
  ): AgentTool => {
    const schema = (template.schema as z.ZodObject).extend({
      repo: z
        .string()
        .min(1)
        .describe('Full name (owner/name) of a repository in the space'),
    });
    return defineTool({
      name: template.name,
      description: `${template.description} Works on one repository of the space, chosen with "repo".`,
      schema,
      run: async (input, ctx) => {
        const { repo, ...rest } = input as { repo: string } & Record<
          string,
          unknown
        >;
        const target = (await tools(resolve(repo))).find(
          (t) => t.name === template.name,
        );
        if (!target) throw new Error(`Tool ${template.name} is unavailable`);
        return target.run(rest, ctx);
      },
    });
  };

  return [
    defineTool({
      name: 'list_repositories',
      description:
        'List the repositories in this space. Use their full names as the "repo" argument of the other tools.',
      schema: z.object({}),
      run: () =>
        src.repos.length
          ? src.repos
              .map((r) => `- ${r.fullName} (branch ${r.defaultBranch})`)
              .join('\n')
          : 'This space has no repositories yet.',
    }),
    ...CODE_TEMPLATES.map((t) =>
      scoped(t, async (repo) => codeReadTools(await src.workspace(repo))),
    ),
    ...(src.insight
      ? INSIGHT_TEMPLATES.map((t) =>
          scoped(t, (repo) => insightTools(src.insight!(repo))),
        )
      : []),
  ];
}

export interface SavedMap {
  status: 'none' | 'running' | 'done' | 'failed';
  stale: boolean;
  /** `from`/`to` — уже имена репозиториев. */
  edges: {
    from: string;
    to: string;
    kind: string;
    label: string;
    vulnerable?: boolean;
    evidence: { repo: string; filePath?: string; detail: string }[];
  }[];
}

/** Сохранённая карта связей пространства — чтобы не искать связи заново в каждом ответе. */
export function spaceMapTool(load: () => Promise<SavedMap>): AgentTool {
  return defineTool({
    name: 'space_map',
    description:
      'The saved relationship map of this space: which repository depends on, shares dependencies with, or calls which, with evidence. Check it before searching for cross-repository links yourself.',
    schema: z.object({}),
    run: async () => {
      const map = await load();
      if (map.status === 'none')
        return 'No map has been built for this space yet. A teammate can build it from the space overview.';
      if (!map.edges.length)
        return map.status === 'running'
          ? 'The map is being built right now and has no saved relationships yet.'
          : 'The map found no relationships between the repositories.';
      const lines = map.edges.map((e) =>
        [
          `- ${e.from} ${e.kind === 'shared_dependency' ? '<->' : '->'} ${e.to} [${e.kind}${e.vulnerable ? ', vulnerable' : ''}]: ${e.label}`,
          ...e.evidence
            .slice(0, 5)
            .map(
              (ev) =>
                `    ${ev.repo}${ev.filePath ? `:${ev.filePath}` : ''} — ${ev.detail}`,
            ),
        ].join('\n'),
      );
      return [
        map.stale
          ? 'Note: repositories were added or removed after this map was built.'
          : '',
        ...lines,
      ]
        .filter(Boolean)
        .join('\n');
    },
  });
}
