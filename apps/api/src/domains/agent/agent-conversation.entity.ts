import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GitRepository } from '../repositories/git-repository.entity';
import { Space } from '../spaces/space.entity';

@Entity('agent_conversations')
@Index(['spaceId', 'userId', 'updatedAt'])
export class AgentConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Разговор принадлежит пространству; null — старый разговор до появления пространств. */
  @Column({ type: 'uuid', nullable: true })
  spaceId: string | null;

  @ManyToOne(() => Space, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'spaceId' })
  space: Space | null;

  /** Фокус разговора: конкретный репозиторий или null — всё пространство. */
  @Column({ type: 'uuid', nullable: true })
  repositoryId: string | null;

  @ManyToOne(() => GitRepository, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'repositoryId' })
  repository: GitRepository | null;

  @Column({ type: 'uuid' })
  userId: string;

  @Column()
  title: string;

  @OneToMany(() => AgentMessage, (m) => m.conversation)
  messages: AgentMessage[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
}

export enum MessageStatus {
  Pending = 'pending',
  Done = 'done',
  Failed = 'failed',
}

@Entity('agent_messages')
@Index(['conversationId', 'createdAt'])
export class AgentMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => AgentConversation, (c) => c.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversationId' })
  conversation: AgentConversation;

  @Column({ type: 'enum', enum: MessageRole })
  role: MessageRole;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ type: 'enum', enum: MessageStatus, default: MessageStatus.Done })
  status: MessageStatus;

  @Column({ type: 'uuid', nullable: true })
  runId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
