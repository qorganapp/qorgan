import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GitRepository } from '../repositories/git-repository.entity';

export enum AgentRunKind {
  Triage = 'triage',
  Fix = 'fix',
  Review = 'review',
  Chat = 'chat',
}

export enum AgentRunStatus {
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
  Refused = 'refused',
  BudgetExceeded = 'budget_exceeded',
  MaxSteps = 'max_steps',
  Skipped = 'skipped',
}

/** Один запуск агента — для ленты активности и аудита автономных действий. */
@Entity('agent_runs')
@Index(['repositoryId', 'createdAt'])
export class AgentRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  repositoryId: string;

  @ManyToOne(() => GitRepository, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository: GitRepository;

  @Column({ type: 'enum', enum: AgentRunKind })
  kind: AgentRunKind;

  @Column({
    type: 'enum',
    enum: AgentRunStatus,
    default: AgentRunStatus.Running,
  })
  status: AgentRunStatus;

  /** Человекочитаемый заголовок: «Triaged 20 findings», «Fix: upgrade lodash», «Review PR #12». */
  @Column()
  title: string;

  /** Итог для ленты: что агент сделал. */
  @Column({ type: 'text', default: '' })
  summary: string;

  /** Ссылки на объекты: scanId, findingIds, prNumber, prUrl, conversationId… */
  @Column({ type: 'jsonb', default: {} })
  target: Record<string, unknown>;

  @Column({ default: '' })
  model: string;

  @Column({ type: 'int', default: 0 })
  inputTokens: number;

  @Column({ type: 'int', default: 0 })
  outputTokens: number;

  @Column({ type: 'int', default: 0 })
  steps: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @OneToMany(() => AgentStep, (s) => s.run)
  stepLog: AgentStep[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}

@Entity('agent_steps')
@Index(['runId', 'index'])
export class AgentStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  runId: string;

  @ManyToOne(() => AgentRun, (r) => r.stepLog, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'runId' })
  run: AgentRun;

  @Column({ type: 'int' })
  index: number;

  @Column({ type: 'text', default: '' })
  text: string;

  /** Вызовы инструментов с входом и (усечённым) результатом. */
  @Column({ type: 'jsonb', default: [] })
  toolCalls: {
    name: string;
    input: unknown;
    result: string;
    isError: boolean;
  }[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
