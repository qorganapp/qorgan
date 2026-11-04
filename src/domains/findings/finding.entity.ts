import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ScanModule, Severity } from '../../common/security.types';
import { GitRepository } from '../repositories/git-repository.entity';

export type VerdictKind = 'true_positive' | 'false_positive' | 'needs_context';

/** Заключение AI-агента по находке. */
export interface AgentVerdict {
  verdict: VerdictKind;
  reachable: 'yes' | 'no' | 'unknown';
  /** Критичность с учётом контекста этого репозитория. */
  severity: Severity;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  exploitScenario?: string;
  fixHint?: string;
  runId: string;
  at: string;
}

export enum FindingStatus {
  Open = 'open',
  Ignored = 'ignored',
  Fixed = 'fixed',
}

/**
 * Находка живёт на уровне репозитория и переживает сканы:
 * одна и та же проблема (один fingerprint) — одна строка.
 */
@Entity('findings')
@Index(['repositoryId', 'fingerprint'], { unique: true })
@Index(['lastSeenScanId'])
export class Finding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  repositoryId: string;

  @ManyToOne(() => GitRepository, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository: GitRepository;

  @Column({ type: 'enum', enum: ScanModule })
  module: ScanModule;

  @Column()
  tool: string;

  @Column()
  ruleId: string;

  @Column({ type: 'enum', enum: Severity })
  severity: Severity;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', nullable: true })
  filePath: string | null;

  @Column({ type: 'int', nullable: true })
  line: number | null;

  @Column({ length: 64 })
  fingerprint: string;

  /** Детали, специфичные для модуля (пакет/версия/fixedIn, CWE, тип секрета…). */
  @Column({ type: 'jsonb', default: {} })
  data: Record<string, unknown>;

  /** Короткое «что сделать». */
  @Column({ type: 'text', default: '' })
  action: string;

  @Column({ type: 'enum', enum: FindingStatus, default: FindingStatus.Open })
  status: FindingStatus;

  @Column({ type: 'real', default: 0 })
  priorityScore: number;

  @Column({ type: 'jsonb', nullable: true })
  agentVerdict: AgentVerdict | null;

  /** Почему статус такой: например, «auto-ignored by agent: false positive». */
  @Column({ type: 'text', nullable: true })
  statusReason: string | null;

  @Column({ type: 'uuid' })
  firstSeenScanId: string;

  @Column({ type: 'uuid' })
  lastSeenScanId: string;

  @Column({ type: 'uuid', nullable: true })
  fixedInScanId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
