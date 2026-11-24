import { FakeProvider } from '../llm/fake.provider';
import { runMap } from './map.skill';

const call = (name: string, input: unknown) => ({
  toolCalls: [{ id: name, name, input }],
});
const repos = [
  { id: 'r1', fullName: 'acme/shop' },
  { id: 'r2', fullName: 'acme/orders' },
];
const evidence = [
  {
    repo: 'acme/shop',
    file_path: './src/orders.ts',
    detail: 'fetch(ORDERS_URL + "/orders")',
  },
];

describe('runMap', () => {
  it('records relationships between repositories of the space with evidence', async () => {
    const provider = new FakeProvider([
      call('submit_relationship', {
        from: 'acme/shop',
        to: 'acme/orders',
        description: 'calls the orders HTTP API',
        evidence,
      }),
      call('finish_map', { summary: 'The shop calls the orders service.' }),
    ]);
    const out = await runMap({ provider, repos, tools: [], known: [] });
    expect(out.edges).toEqual([
      {
        from: 'r1',
        to: 'r2',
        kind: 'calls',
        label: 'calls the orders HTTP API',
        evidence: [
          {
            repo: 'acme/shop',
            filePath: 'src/orders.ts',
            detail: 'fetch(ORDERS_URL + "/orders")',
          },
        ],
      },
    ]);
    expect(out.summary).toBe('The shop calls the orders service.');
  });

  it('rejects repositories outside the space, self-links and duplicates', async () => {
    const rel = (from: string, to: string, description: string) =>
      call('submit_relationship', { from, to, description, evidence });
    const provider = new FakeProvider([
      rel('acme/shop', 'evil/other', 'calls something else'),
      rel('acme/shop', 'acme/shop', 'calls itself'),
      rel('acme/shop', 'acme/orders', 'first description'),
      rel('acme/shop', 'acme/orders', 'better description'),
      call('finish_map', { summary: 'Done mapping.' }),
    ]);
    const out = await runMap({ provider, repos, tools: [], known: [] });
    const inputs = provider.sessions[0].inputs as { content: string }[][];
    expect(inputs[1][0].content).toContain(
      'must be repositories of this space',
    );
    expect(inputs[2][0].content).toContain('two different repositories');
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].label).toBe('better description');
  });

  it('tells the agent which package links are already known', async () => {
    const provider = new FakeProvider([
      call('finish_map', { summary: 'Nothing beyond packages.' }),
    ]);
    await runMap({
      provider,
      repos,
      tools: [],
      known: [
        {
          from: 'r1',
          to: 'r2',
          kind: 'depends_on',
          label: 'uses @acme/sdk',
          evidence: [],
        },
      ],
    });
    expect(provider.sessions[0].inputs[0]).toContain(
      'acme/shop → acme/orders: uses @acme/sdk',
    );
  });
});
