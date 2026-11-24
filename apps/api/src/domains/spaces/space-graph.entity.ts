import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SpaceEdge, SpaceNode } from './graph/graph.types';
import { Space } from './space.entity';

export enum SpaceGraphStatus {
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
}

/** Карта связей между репозиториями пространства — последняя построенная. */
@Entity('space_graphs')
export class SpaceGraph {
  @PrimaryColumn({ type: 'uuid' })
  spaceId: string;

  @OneToOne(() => Space, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spaceId' })
  space: Space;

  @Column({ type: 'enum', enum: SpaceGraphStatus })
  status: SpaceGraphStatus;

  @Column({ type: 'jsonb', default: [] })
  nodes: SpaceNode[];

  @Column({ type: 'jsonb', default: [] })
  edges: SpaceEdge[];

  /** Запуск агента, который искал вызовы между сервисами. */
  @Column({ type: 'uuid', nullable: true })
  runId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Когда началось текущее (или последнее) построение. */
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  generatedAt: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
