import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicProvider, Effort } from './anthropic.provider';
import { LlmProvider } from './llm-provider';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Выбор провайдера по env. Новые провайдеры (локальные модели для self-hosted) — сюда. */
export function createLlmProvider(config: ConfigService): LlmProvider | null {
  const provider = config.get<string>('LLM_PROVIDER', 'anthropic');
  switch (provider) {
    case 'anthropic': {
      const effort = config.get<string>('LLM_EFFORT', 'high') as Effort;
      try {
        return new AnthropicProvider({
          model: config.get<string>('LLM_MODEL', 'claude-opus-5-5'),
          effort: EFFORTS.includes(effort) ? effort : 'high',
        });
      } catch (e) {
        // Нет учётных данных — агент выключен, сканы работают как раньше.
        new Logger('Agent').warn(`AI agent disabled: ${(e as Error).message}`);
        return null;
      }
    }
    case 'none':
      return null;
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
  }
}
