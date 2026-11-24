import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { GitRepository } from '../repositories/git-repository.entity';
import { Space } from './space.entity';

/**
 * Репозиторий в пространстве (многие-ко-многим).
 * CASCADE с обеих сторон: синхронизация установки GitHub жёстко удаляет репозитории.
 */
@Entity('space_repositories')
@Index(['repositoryId'])
export class SpaceRepository {
  @PrimaryColumn({ type: 'uuid' })
  spaceId: string;

  @PrimaryColumn({ type: 'uuid' })
  repositoryId: string;

  @ManyToOne(() => Space, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spaceId' })
  space: Space;

  @ManyToOne(() => GitRepository, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository: GitRepository;

  @CreateDateColumn({ type: 'timestamptz' })
  addedAt: Date;
}
