import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from './anthropic.provider';

function fakeClient(messages: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        stream: (params: Record<string, unknown>) => {
          calls.push(structuredClone(params));
          const next = messages[i++];
          return {
            finalMessage: () =>
              next instanceof Error
                ? Promise.reject(next)
                : Promise.resolve(next),
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const msg = (
  content: unknown[],
  stop_reason = 'end_turn',
  extra: Record<string, unknown> = {},
) => ({
  model: 'claude-opus-5-5',
  content,
  stop_reason,
  stop_details: null,
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 90,
    cache_creation_input_tokens: 0,
  },
  ...extra,
});

describe('AnthropicProvider', () => {
  it('maps tool calls, keeps the full assistant content (incl. thinking) in history and sends tool results', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
    const { client, calls } = fakeClient([
      msg(
        [
          thinking,
          {
            type: 'tool_use',
            id: 't1',
            name: 'read_file',
            input: { path: 'a' },
          },
        ],
        'tool_use',
      ),
      msg([{ type: 'text', text: 'done' }]),
    ]);
    const session = new AnthropicProvider({
      model: 'claude-opus-5-5',
      effort: 'high',
      client,
    }).startSession({
      system: 'sys',
      tools: [
        {
          name: 'read_file',
          description: 'd',
          inputSchema: { type: 'object' },
        },
      ],
    });

    const first = await session.send('task');
    expect(first).toMatchObject({
      stop: 'tool_use',
      toolCalls: [{ id: 't1', name: 'read_file' }],
    });
    expect(first.usage.inputTokens).toBe(100);

    const second = await session.send([{ callId: 't1', content: 'file body' }]);
    expect(second).toMatchObject({ stop: 'end', text: 'done' });

    const req = calls[1] as {
      messages: { role: string; content: unknown }[];
      fallbacks: unknown;
      betas: string[];
      tools: { eager_input_streaming: boolean }[];
    };
    expect(req.messages[1]).toEqual({
      role: 'assistant',
      content: [thinking, expect.objectContaining({ type: 'tool_use' })],
    });
    expect(req.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: 'file body' },
    ]);
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toContain('server-side-fallback-2026-07-01');
    expect(req.tools[0].eager_input_streaming).toBe(true);
  });

  it('reports refusals without tool calls', async () => {
    const { client } = fakeClient([
      msg([{ type: 'tool_use', id: 'x', name: 'n', input: {} }], 'refusal', {
        stop_details: { type: 'refusal', category: 'cyber' },
      }),
    ]);
    const turn = await new AnthropicProvider({
      model: 'm',
      effort: 'high',
      client,
    })
      .startSession({ system: 's', tools: [] })
      .send('t');
    expect(turn).toMatchObject({
      stop: 'refusal',
      toolCalls: [],
      refusalCategory: 'cyber',
    });
  });

  it('retries unparseable tool JSON but rethrows API errors', async () => {
    const { client, calls } = fakeClient([
      new SyntaxError('bad json'),
      msg([{ type: 'text', text: 'ok' }]),
    ]);
    const turn = await new AnthropicProvider({
      model: 'm',
      effort: 'high',
      client,
    })
      .startSession({ system: 's', tools: [] })
      .send('t');
    expect(turn.text).toBe('ok');
    expect(calls).toHaveLength(2);

    const apiErr = new Anthropic.RateLimitError(
      429,
      undefined,
      'rate',
      new Headers(),
    );
    const { client: c2 } = fakeClient([apiErr]);
    await expect(
      new AnthropicProvider({ model: 'm', effort: 'high', client: c2 })
        .startSession({ system: 's', tools: [] })
        .send('t'),
    ).rejects.toBe(apiErr);
  });
});
