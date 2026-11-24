import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  LlmProvider,
  LlmSession,
  LlmTurn,
  SessionOptions,
  StopReason,
  ToolResult,
} from './llm-provider';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicProviderOptions {
  model: string;
  effort: Effort;
  client?: Anthropic;
}

/** При отказе модели (например, из-за классификатора по кибербезопасности) запрос
 * автоматически перезапускается на рекомендованной резервной модели на стороне API. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_JSON_RETRIES = 2;

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly effort: Effort;
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model;
    this.effort = options.effort;
    this.client = options.client ?? new Anthropic();
  }

  startSession(options: SessionOptions): LlmSession {
    return new AnthropicSession(this.client, this.model, this.effort, options);
  }
}

class AnthropicSession implements LlmSession {
  private readonly messages: BetaMessageParam[] = [];
  private readonly tools: BetaToolUnion[];

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly effort: Effort,
    private readonly options: SessionOptions,
  ) {
    this.tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as BetaTool['input_schema'],
      // Большие входы (правки файлов) стримятся сразу; валидирует их runtime (zod).
      eager_input_streaming: true,
    }));
  }

  async send(input: string | ToolResult[]): Promise<LlmTurn> {
    const content: string | BetaContentBlockParam[] =
      typeof input === 'string'
        ? input
        : input.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.callId,
            content: r.content,
            is_error: r.isError || undefined,
          }));
    this.messages.push({ role: 'user', content });

    const message = await this.request();
    // Ответ целиком (включая thinking-блоки) — в историю без изменений.
    this.messages.push({
      role: 'assistant',
      content: message.content as BetaContentBlockParam[],
    });
    return toTurn(message);
  }

  private async request(): Promise<BetaMessage> {
    for (let attempt = 0; ; attempt++) {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: this.options.maxTokens ?? 32000,
        system: [
          {
            type: 'text',
            text: this.options.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: this.tools,
        messages: this.messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort },
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      });
      try {
        return await stream.finalMessage();
      } catch (err) {
        // Ретраим только непарсящийся JSON входа инструмента; ошибки API пробрасываем.
        if (err instanceof Anthropic.APIError || attempt >= MAX_JSON_RETRIES)
          throw err;
      }
    }
  }
}

function toTurn(message: BetaMessage): LlmTurn {
  const text: string[] = [];
  const toolCalls: LlmTurn['toolCalls'] = [];
  for (const block of message.content) {
    if (block.type === 'text') text.push(block.text);
    if (block.type === 'tool_use')
      toolCalls.push({ id: block.id, name: block.name, input: block.input });
  }
  const stop: StopReason =
    message.stop_reason === 'refusal'
      ? 'refusal'
      : message.stop_reason === 'max_tokens'
        ? 'max_tokens'
        : toolCalls.length
          ? 'tool_use'
          : 'end';
  return {
    text: text.join('\n').trim(),
    toolCalls: stop === 'refusal' ? [] : toolCalls,
    stop,
    usage: {
      inputTokens:
        message.usage.input_tokens +
        (message.usage.cache_read_input_tokens ?? 0) +
        (message.usage.cache_creation_input_tokens ?? 0),
      outputTokens: message.usage.output_tokens,
    },
    refusalCategory: message.stop_details?.category ?? null,
    model: message.model,
  };
}
