import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ScanModule } from '../../common/security.types';
import { GitRepository } from '../repositories/git-repository.entity';

export enum AgentFixStatus {
  Open = 'open',
  Merged = 'merged',
  Closed = 'closed',
}

/** Pull request с исправлением, который открыл агент. */
@Entity('agent_fixes')
@Index(['repositoryId', 'status'])
export class AgentFix {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  repositoryId: string;

  @ManyToOne(() => GitRepository, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository: GitRepository;

  @Column({ type: 'enum', enum: ScanModule })
  module: ScanModule;

  @Column({ type: 'uuid', array: true })
  findingIds: string[];

  @Column()
  title: string;

  @Column()
  branch: string;

  @Column({ type: 'int' })
  prNumber: number;

  @Column()
  prUrl: string;

  @Column({ type: 'enum', enum: AgentFixStatus, default: AgentFixStatus.Open })
  status: AgentFixStatus;

  @Column({ type: 'uuid' })
  runId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
