import {
  RepoManifest,
  SpaceEdge,
  SpaceEdgeEvidence,
  SpaceNode,
} from './graph.types';
import { packageKey } from './manifest-extract';

export interface GraphInput {
  repositoryId: string;
  fullName: string;
  manifest: RepoManifest;
  /** Ключи пакетов (`ecosystem:name`) с открытыми находками Supply Chain. */
  vulnerable?: Set<string>;
}

const MAX_EVIDENCE = 12;

export function buildNodes(inputs: GraphInput[]): SpaceNode[] {
  return inputs.map((r) => ({
    repositoryId: r.repositoryId,
    fullName: r.fullName,
    packages: r.manifest.packages.map((p) => p.name),
    dependencyCount: r.manifest.dependencies.length,
  }));
}

/**
 * Связи, которые видны из манифестов без модели:
 * - depends_on: A зависит от пакета, который публикует B;
 * - shared_dependency: A и B зависят от одного и того же стороннего пакета.
 */
export function buildEdges(inputs: GraphInput[]): SpaceEdge[] {
  // Кто публикует пакет. Одно имя в двух репозиториях — неоднозначно, такие не связываем.
  const publishers = new Map<string, GraphInput | null>();
  for (const repo of inputs) {
    for (const key of new Set(repo.manifest.packages.map(packageKey)))
      publishers.set(key, publishers.has(key) ? null : repo);
  }

  const edges: SpaceEdge[] = [];

  for (const repo of inputs) {
    const byTarget = new Map<string, SpaceEdgeEvidence[]>();
    for (const dep of repo.manifest.dependencies) {
      const owner = publishers.get(packageKey(dep));
      if (!owner || owner.repositoryId === repo.repositoryId) continue;
      const evidence = byTarget.get(owner.repositoryId) ?? [];
      evidence.push({
        repo: repo.fullName,
        filePath: dep.filePath,
        detail: `depends on ${dep.name}, published by ${owner.fullName}`,
      });
      byTarget.set(owner.repositoryId, evidence);
    }
    for (const [to, evidence] of byTarget) {
      edges.push({
        from: repo.repositoryId,
        to,
        kind: 'depends_on',
        label:
          evidence.length === 1
            ? evidence[0].detail.split(',')[0].replace('depends on', 'uses')
            : `uses ${evidence.length} packages`,
        evidence: evidence.slice(0, MAX_EVIDENCE),
      });
    }
  }

  for (let i = 0; i < inputs.length; i++) {
    for (let j = i + 1; j < inputs.length; j++) {
      const a = inputs[i];
      const b = inputs[j];
      const theirs = new Map(
        b.manifest.dependencies.map((d) => [packageKey(d), d]),
      );
      const shared = a.manifest.dependencies
        .map((dep) => ({
          key: packageKey(dep),
          dep,
          other: theirs.get(packageKey(dep)),
        }))
        // Внутренние пакеты пространства уже показаны связью depends_on.
        .filter((s) => s.other && !publishers.get(s.key))
        .map((s) => ({
          ...s,
          vulnerable: !!a.vulnerable?.has(s.key) || !!b.vulnerable?.has(s.key),
        }))
        .sort(
          (x, y) =>
            Number(y.vulnerable) - Number(x.vulnerable) ||
            x.dep.name.localeCompare(y.dep.name),
        );
      if (!shared.length) continue;
      const vulnerable = shared.filter((s) => s.vulnerable).length;
      edges.push({
        from: a.repositoryId,
        to: b.repositoryId,
        kind: 'shared_dependency',
        label:
          `${shared.length} shared ${shared.length === 1 ? 'dependency' : 'dependencies'}` +
          (vulnerable ? `, ${vulnerable} vulnerable` : ''),
        evidence: shared.slice(0, MAX_EVIDENCE).map((s) => ({
          repo: a.fullName,
          filePath: s.dep.filePath,
          detail: `${s.dep.name}${s.vulnerable ? ' — has an open vulnerability' : ''} (also in ${b.fullName}: ${s.other!.filePath})`,
        })),
        ...(vulnerable ? { vulnerable: true } : {}),
      });
    }
  }
  return edges;
}
