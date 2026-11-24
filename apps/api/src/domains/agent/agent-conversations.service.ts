import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AgentConversation,
  AgentMessage,
  MessageRole,
  MessageStatus,
} from './agent-conversation.entity';
import { AgentQueue } from './queue/agent-queue';

/** API-часть чата: хранение диалогов и постановка вопросов агенту в очередь. */
@Injectable()
export class AgentConversationsService {
  constructor(
    @InjectRepository(AgentConversation)
    private readonly conversations: Repository<AgentConversation>,
    @InjectRepository(AgentMessage)
    private readonly messages: Repository<AgentMessage>,
    private readonly queue: AgentQueue,
  ) {}

  list(repositoryId: string, userId: string) {
    return this.conversations.find({
      where: { repositoryId, userId },
      order: { updatedAt: 'DESC' },
      take: 30,
    });
  }

  async get(id: string, userId: string) {
    const conversation = await this.conversations.findOne({
      where: { id, userId },
      relations: { messages: true },
      order: { messages: { createdAt: 'ASC' } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async start(repositoryId: string, userId: string, content: string) {
    const conversation = await this.conversations.save(
      this.conversations.create({
        repositoryId,
        userId,
        title: content.slice(0, 80),
      }),
    );
    await this.ask(conversation, content);
    return this.get(conversation.id, userId);
  }

  async post(id: string, userId: string, content: string) {
    const conversation = await this.get(id, userId);
    if (conversation.messages.some((m) => m.status === MessageStatus.Pending)) {
      throw new ConflictException(
        'The agent is still answering the previous question',
      );
    }
    await this.ask(conversation, content);
    return this.get(id, userId);
  }

  private async ask(conversation: AgentConversation, content: string) {
    await this.messages.save(
      this.messages.create({
        conversationId: conversation.id,
        role: MessageRole.User,
        content,
      }),
    );
    const pending = await this.messages.save(
      this.messages.create({
        conversationId: conversation.id,
        role: MessageRole.Assistant,
        status: MessageStatus.Pending,
      }),
    );
    await this.conversations.update(conversation.id, { updatedAt: new Date() });
    await this.queue.chat({
      conversationId: conversation.id,
      messageId: pending.id,
    });
  }
}
