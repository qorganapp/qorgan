import {
  LlmProvider,
  LlmSession,
  LlmTurn,
  SessionOptions,
  ToolResult,
} from './llm-provider';

export type ScriptStep =
  Partial<LlmTurn> | ((input: string | ToolResult[]) => Partial<LlmTurn>);

/** Детерминированный «LLM» для тестов: отдаёт заранее заданные ходы по порядку. */
export class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly sessions: {
    options: SessionOptions;
    inputs: (string | ToolResult[])[];
  }[] = [];

  constructor(private readonly script: ScriptStep[]) {}

  startSession(options: SessionOptions): LlmSession {
    const record = { options, inputs: [] as (string | ToolResult[])[] };
    this.sessions.push(record);
    let i = 0;
    return {
      send: (input) => {
        record.inputs.push(input);
        const step = this.script[i++];
        if (!step) throw new Error('FakeProvider: script exhausted');
        const turn = typeof step === 'function' ? step(input) : step;
        const toolCalls = turn.toolCalls ?? [];
        return Promise.resolve({
          text: turn.text ?? '',
          toolCalls,
          stop: turn.stop ?? (toolCalls.length ? 'tool_use' : 'end'),
          usage: turn.usage ?? { inputTokens: 100, outputTokens: 20 },
          refusalCategory: turn.refusalCategory,
        });
      },
    };
  }
}
