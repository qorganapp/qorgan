import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ScanModule } from '../../common/security.types';
import { Scan } from './scan.entity';

export enum ModuleRunStatus {
  Done = 'done',
  /** Часть инструментов модуля упала — результаты неполные. */
  Partial = 'partial',
  Failed = 'failed',
}

export interface ToolRunInfo {
  tool: string;
  ok: boolean;
  version?: string;
  findings: number;
  durationMs: number;
  error?: string;
}

@Entity('scan_module_runs')
@Unique(['scanId', 'module'])
export class ScanModuleRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  scanId: string;

  @ManyToOne(() => Scan, (scan) => scan.moduleRuns, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scanId' })
  scan: Scan;

  @Column({ type: 'enum', enum: ScanModule })
  module: ScanModule;

  @Column({ type: 'enum', enum: ModuleRunStatus })
  status: ModuleRunStatus;

  @Column({ type: 'jsonb', default: [] })
  tools: ToolRunInfo[];

  @Column({ type: 'int' })
  durationMs: number;
}
