import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpaceEdge, SpaceNode } from './graph/graph.types';
import { SpaceGraph, SpaceGraphStatus } from './space-graph.entity';
import { Space } from './space.entity';

export interface SpaceGraphView {
  spaceId: string;
  status: 'none' | 'running' | 'done' | 'failed';
  /** Состав репозиториев менялся после построения — карту стоит обновить. */
  stale: boolean;
  nodes: SpaceNode[];
  edges: SpaceEdge[];
  runId: string | null;
  error: string | null;
  generatedAt: Date | null;
}

/** Воркер мог умереть посреди построения: «вечный» running считаем ошибкой. */
const STUCK_AFTER_MS = 45 * 60_000;

@Injectable()
export class SpaceGraphService {
  constructor(
    @InjectRepository(SpaceGraph)
    private readonly graphs: Repository<SpaceGraph>,
  ) {}

  async view(space: Space): Promise<SpaceGraphView> {
    const graph = await this.graphs.findOneBy({ spaceId: space.id });
    if (!graph) {
      return {
        spaceId: space.id,
        status: 'none',
        stale: false,
        nodes: [],
        edges: [],
        runId: null,
        error: null,
        generatedAt: null,
      };
    }
    const stuck =
      graph.status === SpaceGraphStatus.Running &&
      Date.now() - (graph.startedAt?.getTime() ?? 0) > STUCK_AFTER_MS;
    return {
      spaceId: space.id,
      status: stuck ? 'failed' : graph.status,
      stale:
        !!graph.generatedAt && space.repositoriesChangedAt > graph.generatedAt,
      nodes: graph.nodes,
      edges: graph.edges,
      runId: graph.runId,
      error: stuck ? 'Building the map did not finish' : graph.error,
      generatedAt: graph.generatedAt,
    };
  }

  /** Прошлая карта остаётся видимой, пока строится новая. */
  async begin(spaceId: string): Promise<void> {
    await this.graphs.upsert(
      {
        spaceId,
        status: SpaceGraphStatus.Running,
        error: null,
        startedAt: new Date(),
      },
      ['spaceId'],
    );
  }

  async complete(
    spaceId: string,
    result: {
      nodes: SpaceNode[];
      edges: SpaceEdge[];
      runId: string | null;
      /** Момент, на который зафиксирован состав репозиториев. */
      at: Date;
    },
  ): Promise<void> {
    await this.graphs.update(spaceId, {
      status: SpaceGraphStatus.Done,
      nodes: result.nodes,
      edges: result.edges,
      runId: result.runId,
      error: null,
      generatedAt: result.at,
    });
  }

  async fail(spaceId: string, error: string): Promise<void> {
    await this.graphs.update(spaceId, {
      status: SpaceGraphStatus.Failed,
      error: error.slice(0, 500),
    });
  }
}
