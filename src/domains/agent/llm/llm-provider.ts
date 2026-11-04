/**
 * Провайдер-нейтральный интерфейс LLM. Агент знает только эти типы — конкретная модель
 * (Claude, локальная модель для self-hosted и т.п.) подключается реализацией LlmProvider.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema входных параметров. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  callId: string;
  content: string;
  isError?: boolean;
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmTurn {
  text: string;
  toolCalls: ToolCall[];
  stop: StopReason;
  usage: LlmUsage;
  /** Категория отказа, если модель отказалась отвечать (например, "cyber"). */
  refusalCategory?: string | null;
  /** Какая модель фактически ответила (может отличаться при fallback). */
  model?: string;
}

/**
 * Диалог с моделью. История хранится внутри провайдера в его родном формате и только
 * дополняется — так служебные блоки модели (например, thinking) возвращаются в API без изменений.
 */
export interface LlmSession {
  send(input: string | ToolResult[]): Promise<LlmTurn>;
}

export interface SessionOptions {
  system: string;
  tools: ToolSpec[];
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  startSession(options: SessionOptions): LlmSession;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
