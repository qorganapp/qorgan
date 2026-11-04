import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FindingsModule } from '../findings/findings.module';
import { GithubModule } from '../github/github.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { ScansModule } from '../scans/scans.module';
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
    TypeOrmModule.forFeature([AgentRun, AgentStep, AgentFix]),
    AgentQueueModule,
    GithubModule,
    FindingsModule,
    ScansModule,
    RepositoriesModule,
  ],
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
  ],
  exports: [
    AgentRunsService,
    AgentTriageService,
    AgentFixService,
    LLM_PROVIDER,
  ],
})
export class AgentModule {}
