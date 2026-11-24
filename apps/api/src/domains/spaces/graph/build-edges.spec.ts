import { buildEdges, buildNodes, GraphInput } from './build-edges';
import { ManifestEntry } from './graph.types';

const npm = (name: string, filePath = 'package.json'): ManifestEntry => ({
  name,
  ecosystem: 'npm',
  filePath,
});

const repo = (
  id: string,
  packages: string[],
  dependencies: string[],
  vulnerable: string[] = [],
): GraphInput => ({
  repositoryId: id,
  fullName: `acme/${id}`,
  manifest: {
    packages: packages.map((p) => npm(p)),
    dependencies: dependencies.map((d) => npm(d)),
  },
  vulnerable: new Set(vulnerable.map((v) => `npm:${v}`)),
});

describe('buildEdges', () => {
  it('links a repository to the one that publishes a package it uses', () => {
    const edges = buildEdges([
      repo('shop', ['shop'], ['@acme/sdk']),
      repo('sdk', ['@acme/sdk'], []),
    ]);
    expect(edges).toEqual([
      expect.objectContaining({
        from: 'shop',
        to: 'sdk',
        kind: 'depends_on',
        label: 'uses @acme/sdk',
      }),
    ]);
    expect(edges[0].evidence[0]).toMatchObject({
      repo: 'acme/shop',
      filePath: 'package.json',
    });
  });

  it('groups shared third-party dependencies into one edge and flags vulnerable ones', () => {
    const edges = buildEdges([
      repo('shop', [], ['express', 'minimist', 'zod'], ['minimist']),
      repo('admin', [], ['express', 'minimist']),
      repo('docs', [], ['vitepress']),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: 'shop',
      to: 'admin',
      kind: 'shared_dependency',
      label: '2 shared dependencies, 1 vulnerable',
      vulnerable: true,
    });
    expect(edges[0].evidence[0].detail).toContain('minimist');
  });

  it('does not report an internal package as a shared dependency, nor link ambiguous publishers', () => {
    const internal = buildEdges([
      repo('shop', [], ['@acme/sdk']),
      repo('admin', [], ['@acme/sdk']),
      repo('sdk', ['@acme/sdk'], []),
    ]);
    expect(internal.map((e) => e.kind)).toEqual(['depends_on', 'depends_on']);

    const ambiguous = buildEdges([
      repo('a', ['utils'], []),
      repo('b', ['utils'], []),
      repo('c', [], ['utils']),
    ]);
    expect(ambiguous).toEqual([]);
  });

  it('describes nodes with what they publish', () => {
    expect(buildNodes([repo('sdk', ['@acme/sdk'], ['zod'])])).toEqual([
      {
        repositoryId: 'sdk',
        fullName: 'acme/sdk',
        packages: ['@acme/sdk'],
        dependencyCount: 1,
      },
    ]);
  });
});
