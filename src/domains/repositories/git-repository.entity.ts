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

  @ManyToOne(() => GithubInstallation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'installationId' })
  installation: GithubInstallation;

  @CreateDateColumn()
  createdAt: Date;
}
