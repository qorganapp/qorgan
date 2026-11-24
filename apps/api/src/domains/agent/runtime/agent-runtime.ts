import {
  LlmProvider,
  LlmTurn,
  LlmUsage,
  ToolResult,
} from '../llm/llm-provider';
import { AgentTool, ToolInputError, toToolSpec } from './agent-tool';

export type RunStatus =
  'done' | 'failed' | 'refused' | 'budget_exceeded' | 'max_steps';

export interface StepRecord {
  index: number;
  /** Что сказала модель на этом шаге. */
  text: string;
  toolCalls: {
    name: string;
    input: unknown;
    result: string;
    isError: boolean;
  }[];
  usage: LlmUsage;
}

export interface RunOptions {
  provider: LlmProvider;
  system: string;
  tools: AgentTool[];
  task: string;
  maxSteps?: number;
  /** Суммарный лимит токенов (вход + выход) на один запуск. */
  tokenBudget?: number;
  onStep?: (step: StepRecord) => Promise<void> | void;
}

export interface RunResult {
  status: RunStatus;
  finalText: string;
  usage: LlmUsage;
  steps: number;
  refusalCategory?: string | null;
  error?: string;
}

const MAX_RESULT_CHARS = 30_000;

/**
 * Цикл агента: модель → вызовы инструментов → результаты → модель…
 * Провайдер-нейтральный; все входы инструментов валидируются схемой (zod) до запуска.
 */
export async function runAgent(options: RunOptions): Promise<RunResult> {
  const maxSteps = options.maxSteps ?? 25;
  const tokenBudget = options.tokenBudget ?? 400_000;
  const toolsByName = new Map(options.tools.map((t) => [t.name, t]));
  const session = options.provider.startSession({
    system: options.system,
    tools: options.tools.map(toToolSpec),
  });

  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let finished = false;
  let lastText = '';
  let input: string | ToolResult[] = options.task;

  for (let index = 0; index < maxSteps; index++) {
    let turn: LlmTurn;
    try {
      turn = await session.send(input);
    } catch (e) {
      return {
        status: 'failed',
        finalText: lastText,
        usage,
        steps: index,
        error: (e as Error).message,
      };
    }
    usage.inputTokens += turn.usage.inputTokens;
    usage.outputTokens += turn.usage.outputTokens;
    if (turn.text) lastText = turn.text;

    if (turn.stop === 'refusal') {
      await options.onStep?.({
        index,
        text: turn.text,
        toolCalls: [],
        usage: turn.usage,
      });
      return {
        status: 'refused',
        finalText: lastText,
        usage,
        steps: index + 1,
        refusalCategory: turn.refusalCategory,
      };
    }

    const results: ToolResult[] = [];
    const record: StepRecord = {
      index,
      text: turn.text,
      toolCalls: [],
      usage: turn.usage,
    };
    const ctx = { finish: () => (finished = true) };

    for (const call of turn.toolCalls) {
      const result = await executeTool(
        toolsByName.get(call.name),
        call.name,
        call.input,
        ctx,
        turn.stop,
      );
      results.push({ callId: call.id, ...result });
      record.toolCalls.push({
        name: call.name,
        input: call.input,
        result: result.content,
        isError: !!result.isError,
      });
    }
    await options.onStep?.(record);

    if (!turn.toolCalls.length || finished) {
      return { status: 'done', finalText: lastText, usage, steps: index + 1 };
    }
    if (usage.inputTokens + usage.outputTokens > tokenBudget) {
      return {
        status: 'budget_exceeded',
        finalText: lastText,
        usage,
        steps: index + 1,
      };
    }
    input = results;
  }
  return { status: 'max_steps', finalText: lastText, usage, steps: maxSteps };
}

async function executeTool(
  tool: AgentTool | undefined,
  name: string,
  rawInput: unknown,
  ctx: { finish(): void },
  stop: LlmTurn['stop'],
): Promise<{ content: string; isError?: boolean }> {
  if (!tool) return { content: `Unknown tool "${name}"`, isError: true };
  // Вход, обрезанный по max_tokens, часто выглядит как валидный частичный объект — не исполняем.
  if (stop === 'max_tokens') {
    return {
      content: 'Tool input was truncated. Retry with a smaller input.',
      isError: true,
    };
  }
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    return { content: `Invalid input: ${parsed.error.message}`, isError: true };
  }
  try {
    const out = await tool.run(parsed.data, ctx);
    return {
      content:
        out.length > MAX_RESULT_CHARS
          ? `${out.slice(0, MAX_RESULT_CHARS)}\n…[truncated]`
          : out,
    };
  } catch (e) {
    if (e instanceof ToolInputError)
      return { content: e.message, isError: true };
    return { content: `Tool failed: ${(e as Error).message}`, isError: true };
  }
}
