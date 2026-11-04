import { z } from 'zod';
import { ToolSpec } from '../llm/llm-provider';

export interface ToolContext {
  /** Завершить работу агента после текущей пачки вызовов (финальный инструмент навыка). */
  finish(): void;
}

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<string> | string;
}

export function defineTool<S extends z.ZodType>(
  tool: AgentTool<S>,
): AgentTool<S> {
  return tool;
}

export function toToolSpec(tool: AgentTool): ToolSpec {
  const schema = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schema,
  };
}

/** Ошибка, текст которой показываем модели как результат инструмента (is_error). */
export class ToolInputError extends Error {}
