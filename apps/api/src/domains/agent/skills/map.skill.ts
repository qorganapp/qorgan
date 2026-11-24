import { z } from 'zod';
import type {
  SpaceEdge,
  SpaceEdgeEvidence,
} from '../../spaces/graph/graph.types';
import { LlmProvider } from '../llm/llm-provider';
import { MAP_SYSTEM } from '../prompts/map';
import { AgentTool, defineTool } from '../runtime/agent-tool';
import { runAgent, RunResult, StepRecord } from '../runtime/agent-runtime';

export interface MapRepo {
  id: string;
  fullName: string;
}

export interface MapOutcome {
  result: RunResult;
  /** Связи вида `calls`, найденные агентом в коде. */
  edges: SpaceEdge[];
  summary: string;
}

const MAX_RELATIONSHIPS = 40;
const MAX_EVIDENCE = 6;

/** Агент ищет в коде связи между сервисами пространства, которых не видно из манифестов. */
export async function runMap(opts: {
  provider: LlmProvider;
  repos: MapRepo[];
  /** Инструменты чтения кода пространства (с аргументом `repo`). */
  tools: AgentTool[];
  /** Связи, уже найденные по манифестам — чтобы агент их не повторял. */
  known: SpaceEdge[];
  maxSteps?: number;
  tokenBudget?: number;
  onStep?: (s: StepRecord) => Promise<void> | void;
}): Promise<MapOutcome> {
  const byName = new Map(opts.repos.map((r) => [r.fullName.toLowerCase(), r]));
  const nameOf = new Map(opts.repos.map((r) => [r.id, r.fullName]));
  const names = opts.repos.map((r) => r.fullName).join(', ');
  const found = new Map<string, SpaceEdge>();
  let summary = '';

  const tools = [
    ...opts.tools,
    defineTool({
      name: 'submit_relationship',
      description:
        'Record a runtime relationship between two repositories of the space, with evidence from the code you read.',
      schema: z.object({
        from: z
          .string()
          .describe(
            'Full name of the calling, consuming or deploying repository',
          ),
        to: z
          .string()
          .describe(
            'Full name of the repository being called, consumed or deployed',
          ),
        description: z
          .string()
          .min(5)
          .max(140)
          .describe('Short label, e.g. "calls the orders HTTP API"'),
        evidence: z
          .array(
            z.object({
              repo: z.string().describe('Repository the file is in'),
              file_path: z.string().min(1),
              detail: z.string().min(5).max(300),
            }),
          )
          .min(1)
          .max(MAX_EVIDENCE),
      }),
      run: ({ from, to, description, evidence }) => {
        const a = byName.get(from.trim().toLowerCase());
        const b = byName.get(to.trim().toLowerCase());
        if (!a || !b)
          return `Both "from" and "to" must be repositories of this space: ${names}`;
        if (a.id === b.id)
          return 'A relationship needs two different repositories.';
        const clean: SpaceEdgeEvidence[] = [];
        for (const e of evidence) {
          const repo = byName.get(e.repo.trim().toLowerCase());
          if (!repo)
            return `Evidence repository "${e.repo}" is not in this space: ${names}`;
          clean.push({
            repo: repo.fullName,
            filePath: e.file_path.replace(/^\.?\//, ''),
            detail: e.detail,
          });
        }
        const key = `${a.id}>${b.id}`;
        if (!found.has(key) && found.size >= MAX_RELATIONSHIPS)
          return 'Relationship limit reached; describe the rest in the summary.';
        found.set(key, {
          from: a.id,
          to: b.id,
          kind: 'calls',
          label: description,
          evidence: clean,
        });
        return `Relationship recorded (${found.size}).`;
      },
    }),
    defineTool({
      name: 'finish_map',
      description: 'Finish mapping the space.',
      schema: z.object({ summary: z.string().min(5).max(1500) }),
      run: (input, ctx) => {
        summary = input.summary;
        ctx.finish();
        return 'Map finished.';
      },
    }),
  ];

  const known = opts.known.length
    ? opts.known
        .map(
          (e) =>
            `- ${nameOf.get(e.from)} ${e.kind === 'depends_on' ? '→' : '↔'} ${nameOf.get(e.to)}: ${e.label}`,
        )
        .join('\n')
    : 'None.';
  const task = [
    `Repositories in the space:\n${opts.repos.map((r) => `- ${r.fullName}`).join('\n')}`,
    `Package-level links already known from manifests:\n${known}`,
    'Find the runtime relationships between these repositories.',
  ].join('\n\n');

  const result = await runAgent({
    provider: opts.provider,
    system: MAP_SYSTEM,
    tools,
    task,
    maxSteps: opts.maxSteps ?? 40,
    tokenBudget: opts.tokenBudget,
    onStep: opts.onStep,
  });
  return { result, edges: [...found.values()], summary };
}
