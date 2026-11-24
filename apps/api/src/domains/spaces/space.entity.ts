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
import { User } from '../users/user.entity';

/** Пространство — именованная группа репозиториев пользователя; в нём живёт агент. */
@Entity('spaces')
@Index(['userId', 'name'])
export class Space {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ length: 60 })
  name: string;

  /** Когда последний раз менялся состав репозиториев: по нему карта связей считается устаревшей. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  repositoriesChangedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
