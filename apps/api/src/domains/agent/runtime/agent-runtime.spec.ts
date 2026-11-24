import { z } from 'zod';
import { FakeProvider } from '../llm/fake.provider';
import { defineTool, ToolInputError } from './agent-tool';
import { runAgent } from './agent-runtime';

const echo = defineTool({
  name: 'echo',
  description: 'echo',
  schema: z.object({ text: z.string() }),
  run: ({ text }) => `echo:${text}`,
});
const submit = defineTool({
  name: 'submit',
  description: 'final',
  schema: z.object({ ok: z.boolean() }),
  run: (_input, ctx) => {
    ctx.finish();
    return 'saved';
  },
});
const failing = defineTool({
  name: 'failing',
  description: 'always fails',
  schema: z.object({}),
  run: () => {
    throw new ToolInputError('bad path');
  },
});

const call = (name: string, input: unknown, id = name) => ({
  toolCalls: [{ id, name, input }],
});

describe('runAgent', () => {
  it('runs tools, feeds results back and stops when the model ends its turn', async () => {
    const provider = new FakeProvider([
      call('echo', { text: 'hi' }),
      { text: 'all done' },
    ]);
    const steps: unknown[] = [];
    const res = await runAgent({
      provider,
      system: 's',
      tools: [echo],
      task: 'task',
      onStep: (s) => void steps.push(s),
    });
    expect(res).toMatchObject({
      status: 'done',
      finalText: 'all done',
      steps: 2,
    });
    expect(provider.sessions[0].inputs[1]).toEqual([
      { callId: 'echo', content: 'echo:hi' },
    ]);
    expect(provider.sessions[0].options.tools[0].inputSchema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
    });
    expect(steps).toHaveLength(2);
  });

  it('stops right after a finishing tool without another model call', async () => {
    const provider = new FakeProvider([call('submit', { ok: true })]);
    const res = await runAgent({
      provider,
      system: 's',
      tools: [submit],
      task: 't',
    });
    expect(res.status).toBe('done');
    expect(provider.sessions[0].inputs).toHaveLength(1);
  });

  it('returns schema and tool errors to the model instead of crashing', async () => {
    const provider = new FakeProvider([
      {
        toolCalls: [
          { id: 'a', name: 'echo', input: { text: 1 } },
          { id: 'b', name: 'failing', input: {} },
          { id: 'c', name: 'nope', input: {} },
        ],
      },
      { text: 'ok' },
    ]);
    await runAgent({
      provider,
      system: 's',
      tools: [echo, failing],
      task: 't',
    });
    const results = provider.sessions[0].inputs[1] as {
      callId: string;
      content: string;
      isError?: boolean;
    }[];
    expect(results.map((r) => r.isError)).toEqual([true, true, true]);
    expect(results[1].content).toBe('bad path');
    expect(results[2].content).toContain('Unknown tool');
  });

  it('does not execute tool input truncated by max_tokens', async () => {
    const run = jest.fn(() => 'x');
    const tool = defineTool({
      name: 't',
      description: '',
      schema: z.object({}),
      run,
    });
    const provider = new FakeProvider([
      { ...call('t', {}), stop: 'max_tokens' },
      { text: 'end' },
    ]);
    await runAgent({ provider, system: 's', tools: [tool], task: 't' });
    expect(run).not.toHaveBeenCalled();
  });

  it('reports refusals, step limits and token budgets', async () => {
    const refused = await runAgent({
      provider: new FakeProvider([
        { stop: 'refusal', refusalCategory: 'cyber' },
      ]),
      system: 's',
      tools: [],
      task: 't',
    });
    expect(refused).toMatchObject({
      status: 'refused',
      refusalCategory: 'cyber',
    });

    const loop = new FakeProvider(
      Array.from({ length: 10 }, () => call('echo', { text: 'x' })),
    );
    expect(
      (
        await runAgent({
          provider: loop,
          system: 's',
          tools: [echo],
          task: 't',
          maxSteps: 3,
        })
      ).status,
    ).toBe('max_steps');

    const big = new FakeProvider([
      {
        ...call('echo', { text: 'x' }),
        usage: { inputTokens: 900, outputTokens: 200 },
      },
      { text: 'never' },
    ]);
    expect(
      (
        await runAgent({
          provider: big,
          system: 's',
          tools: [echo],
          task: 't',
          tokenBudget: 1000,
        })
      ).status,
    ).toBe('budget_exceeded');
  });

  it('turns provider errors into a failed run', async () => {
    const res = await runAgent({
      provider: new FakeProvider([]),
      system: 's',
      tools: [],
      task: 't',
    });
    expect(res.status).toBe('failed');
  });
});
