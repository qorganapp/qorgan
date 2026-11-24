import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GithubInstallation } from '../github/github-installation.entity';

@Entity('repositories')
export class GitRepository {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'bigint' })
  githubRepoId: string;

  /** owner/name */
  @Column()
  fullName: string;

  @Column({ default: 'main' })
  defaultBranch: string;

  @Column({ default: true })
  private: boolean;

  @Column({ type: 'uuid' })
  installationId: string;

  /** Агент разбирает находки после каждого скана. */
  @Column({ default: true })
  agentTriage: boolean;

  /** Агент сам открывает PR с исправлениями. */
  @Column({ default: true })
  agentAutoFix: boolean;

  /** Агент ревьюит pull request'ы команды. */
  @Column({ default: true })
  agentPrReview: boolean;

  @Column({ type: 'int', default: 3 })
  maxOpenAgentPrs: number;

  @ManyToOne(() => GithubInstallation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'installationId' })
  installation: GithubInstallation;

  @CreateDateColumn()
  createdAt: Date;
}
