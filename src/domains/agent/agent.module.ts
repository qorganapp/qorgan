import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FindingsModule } from '../findings/findings.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { ScansModule } from '../scans/scans.module';
import { AgentRun, AgentStep } from './agent-run.entity';
import { AgentRunsService } from './agent-runs.service';
import { AgentTriageService } from './agent-triage.service';
import { createLlmProvider } from './llm/llm.factory';
import { LLM_PROVIDER } from './llm/llm-provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentRun, AgentStep]),
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
  ],
  exports: [AgentRunsService, AgentTriageService, LLM_PROVIDER],
})
export class AgentModule {}
