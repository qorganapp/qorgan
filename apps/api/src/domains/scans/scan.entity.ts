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
import { ScanModule } from '../../common/security.types';
import { GitRepository } from '../repositories/git-repository.entity';
import { ScanModuleRun } from './scan-module-run.entity';

export enum ScanStatus {
  Queued = 'queued',
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
}

export enum TriageStatus {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Skipped = 'skipped',
  Failed = 'failed',
}

export enum ScanTrigger {
  Manual = 'manual',
  Push = 'push',
}

@Entity('scans')
@Index(['repositoryId', 'createdAt'])
export class Scan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  repositoryId: string;

  @ManyToOne(() => GitRepository, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository: GitRepository;

  @Column()
  branch: string;

  /** Коммит, который просили просканировать (push) или фактический HEAD после клона. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  commitSha: string | null;

  @Column({ type: 'enum', enum: ScanModule, array: true })
  modules: ScanModule[];

  @Column({ type: 'enum', enum: ScanStatus, default: ScanStatus.Queued })
  status: ScanStatus;

  @Column({ type: 'enum', enum: ScanTrigger })
  trigger: ScanTrigger;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Этап разбора находок агентом (после сканеров). null — агент не настроен. */
  @Column({ type: 'enum', enum: TriageStatus, nullable: true })
  triageStatus: TriageStatus | null;

  @OneToMany(() => ScanModuleRun, (run) => run.scan)
  moduleRuns: ScanModuleRun[];

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
