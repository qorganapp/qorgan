import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeProvider } from '../llm/fake.provider';
import { runAgent } from '../runtime/agent-runtime';
import { Workspace } from '../runtime/workspace';
import { InsightSource } from './insight-tools';
import { spaceMapTool, SpaceRepo, spaceTools } from './space-tools';

const shop: SpaceRepo = {
  id: 'r1',
  fullName: 'acme/shop',
  defaultBranch: 'main',
};
const infra: SpaceRepo = {
  id: 'r2',
  fullName: 'acme/infra',
  defaultBranch: 'main',
};

const insight = (repo: SpaceRepo): InsightSource => ({
  latestSummary: () => Promise.resolve({ repo: repo.fullName }),
  findings: () => Promise.resolve([]),
  activity: () => Promise.resolve([]),
  fixPrs: () => Promise.resolve([]),
});

describe('space tools', () => {
  let root: string;
  let opened: string[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'space-tools-'));
    opened = [];
    await mkdir(join(root, 'r1'));
    await mkdir(join(root, 'r2'));
    await writeFile(join(root, 'r1', 'app.ts'), 'fetch(ORDERS_URL)\n');
    await writeFile(
      join(root, 'r2', 'main.tf'),
      'resource "aws_s3_bucket" "b" {}\n',
    );
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const tools = (withInsight = true) =>
    spaceTools({
      repos: [shop, infra],
      workspace: (repo) => {
        opened.push(repo.fullName);
        return Promise.resolve(new Workspace(join(root, repo.id)));
      },
      insight: withInsight ? insight : undefined,
    });

  const run = async (calls: { name: string; input: unknown }[]) => {
    const provider = new FakeProvider([
      { toolCalls: calls.map((c, i) => ({ id: String(i), ...c })) },
      { text: 'done' },
    ]);
    await runAgent({ provider, system: 's', tools: tools(), task: 't' });
    return provider.sessions[0].inputs[1] as {
      content: string;
      isError?: boolean;
    }[];
  };

  it('reads each repository through its own workspace, chosen by the repo argument', async () => {
    const [a, b, list] = await run([
      { name: 'read_file', input: { repo: 'acme/shop', path: 'app.ts' } },
      { name: 'search_code', input: { repo: 'ACME/infra', query: 'aws_s3' } },
      { name: 'list_repositories', input: {} },
    ]);
    expect(a.content).toContain('ORDERS_URL');
    expect(b.content).toContain('main.tf');
    expect(list.content).toContain('acme/shop');
    expect(list.content).toContain('acme/infra');
  });

  it('clones a repository only when the agent first touches it', async () => {
    await run([{ name: 'list_files', input: { repo: 'acme/infra' } }]);
    expect(opened).toEqual(['acme/infra']);
  });

  it('refuses repositories outside the space and paths outside the repository', async () => {
    const [outside, escape, missing] = await run([
      { name: 'read_file', input: { repo: 'evil/other', path: 'app.ts' } },
      {
        name: 'read_file',
        input: { repo: 'acme/shop', path: '../r2/main.tf' },
      },
      { name: 'read_file', input: { path: 'app.ts' } },
    ]);
    expect(outside.content).toContain('is not in this space');
    expect(escape.content).toContain('Path not allowed');
    expect(missing.content).not.toContain('ORDERS_URL');
    expect(opened).toEqual(['acme/shop']);
  });

  it('scopes scan insight tools to a repository and omits them when not provided', async () => {
    const [summary] = await run([
      { name: 'latest_scan_summary', input: { repo: 'acme/infra' } },
    ]);
    expect(summary.content).toContain('acme/infra');
    expect(tools(false).map((t) => t.name)).toEqual([
      'list_repositories',
      'list_files',
      'read_file',
      'search_code',
    ]);
  });

  it('describes the saved map with repository names and evidence', async () => {
    const tool = spaceMapTool(() =>
      Promise.resolve({
        status: 'done',
        stale: true,
        edges: [
          {
            from: 'acme/shop',
            to: 'acme/infra',
            kind: 'calls',
            label: 'reads the uploads bucket',
            evidence: [
              { repo: 'acme/shop', filePath: 'app.ts', detail: 'S3 client' },
            ],
          },
        ],
      }),
    );
    const text = await tool.run({}, { finish: () => undefined });
    expect(text).toContain('acme/shop -> acme/infra [calls]');
    expect(text).toContain('acme/shop:app.ts');
    expect(text).toContain('added or removed after this map was built');
  });
});
