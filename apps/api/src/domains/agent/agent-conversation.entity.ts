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

@Entity('agent_conversations')
@Index(['repositoryId', 'userId', 'updatedAt'])
export class AgentConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  repositoryId: string;

  @ManyToOne(() => GitRepository, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository: GitRepository;

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
