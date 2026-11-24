import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FindingsModule } from '../findings/findings.module';
import { GithubModule } from '../github/github.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { ScansModule } from '../scans/scans.module';
import { AgentChatService } from './agent-chat.service';
import { AgentConversation, AgentMessage } from './agent-conversation.entity';
import { AgentConversationsService } from './agent-conversations.service';
import { AgentController } from './agent.controller';
import { AgentFix } from './agent-fix.entity';
import { AgentFixService } from './agent-fix.service';
import { AgentRun, AgentStep } from './agent-run.entity';
import { AgentQueueModule } from './queue/agent-queue.module';
import { AgentRunsService } from './agent-runs.service';
import { AgentReviewService } from './agent-review.service';
import { AgentTriageService } from './agent-triage.service';
import { createLlmProvider } from './llm/llm.factory';
import { LLM_PROVIDER } from './llm/llm-provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentRun,
      AgentStep,
      AgentFix,
      AgentConversation,
      AgentMessage,
    ]),
    AgentQueueModule,
    GithubModule,
    FindingsModule,
    ScansModule,
    RepositoriesModule,
  ],
  controllers: [AgentController],
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: createLlmProvider,
    },
    AgentRunsService,
    AgentTriageService,
    AgentFixService,
    AgentReviewService,
    AgentConversationsService,
    AgentChatService,
  ],
  exports: [
    AgentRunsService,
    AgentTriageService,
    AgentFixService,
    AgentReviewService,
    AgentChatService,
    LLM_PROVIDER,
  ],
})
export class AgentModule {}
