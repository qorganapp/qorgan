export type SpaceEdgeKind = 'depends_on' | 'shared_dependency' | 'calls';

export interface SpaceEdgeEvidence {
  /** owner/name репозитория, в котором найдено подтверждение. */
  repo: string;
  filePath?: string;
  detail: string;
}

/** Связь между двумя репозиториями пространства; `from`/`to` — id репозиториев. */
export interface SpaceEdge {
  from: string;
  to: string;
  kind: SpaceEdgeKind;
  label: string;
  evidence: SpaceEdgeEvidence[];
  /** Общая зависимость, по которой есть открытая находка Supply Chain. */
  vulnerable?: boolean;
}

export interface SpaceNode {
  repositoryId: string;
  fullName: string;
  /** Пакеты, которые репозиторий публикует (имена из манифестов). */
  packages: string[];
  dependencyCount: number;
}

export type Ecosystem = 'npm' | 'pypi';

export interface ManifestEntry {
  name: string;
  ecosystem: Ecosystem;
  /** Путь манифеста относительно корня репозитория. */
  filePath: string;
}

export interface RepoManifest {
  packages: ManifestEntry[];
  dependencies: ManifestEntry[];
}
