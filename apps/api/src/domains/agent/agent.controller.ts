import {
  Body,
  Controller,
  Get,
  Inject,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RepositoriesService } from '../repositories/repositories.service';
import { AgentConversationsService } from './agent-conversations.service';
import { AgentFix } from './agent-fix.entity';
import { AgentRunsService } from './agent-runs.service';
import { AgentSettingsDto, ChatMessageDto } from './dto/agent.dto';
import { LLM_PROVIDER, LlmProvider } from './llm/llm-provider';

@Controller()
export class AgentController {
  constructor(
    @Optional()
    @Inject(LLM_PROVIDER)
    private readonly provider: LlmProvider | null,
    @InjectRepository(AgentFix) private readonly fixes: Repository<AgentFix>,
    private readonly runs: AgentRunsService,
    private readonly conversations: AgentConversationsService,
    private readonly repositories: RepositoriesService,
  ) {}

  @Get('agent/status')
  status() {
    return {
      enabled: !!this.provider,
      provider: this.provider?.name ?? null,
      model: this.provider?.model ?? null,
    };
  }

  @Get('repositories/:id/agent/activity')
  async activity(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const repo = await this.repositories.findOwned(id, user.id);
    return this.runs.listForRepository(repo.id);
  }

  /** Полный журнал шагов запуска — что агент читал и делал. */
  @Get('agent/runs/:id')
  run(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.getWithSteps(id, user.id);
  }

  @Get('repositories/:id/agent/fixes')
  async listFixes(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const repo = await this.repositories.findOwned(id, user.id);
    return this.fixes.find({
      where: { repositoryId: repo.id },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  @Patch('repositories/:id/agent/settings')
  async settings(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AgentSettingsDto,
  ) {
    const repo = await this.repositories.findOwned(id, user.id);
    return this.repositories.updateAgentSettings(repo.id, dto);
  }

  @Get('repositories/:id/agent/conversations')
  async conversationsList(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const repo = await this.repositories.findOwned(id, user.id);
    return this.conversations.list(repo.id, user.id);
  }

  @Post('repositories/:id/agent/conversations')
  async startConversation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChatMessageDto,
  ) {
    const repo = await this.repositories.findOwned(id, user.id);
    return this.conversations.start(repo.id, user.id, dto.content);
  }

  @Get('agent/conversations/:id')
  conversation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversations.get(id, user.id);
  }

  @Post('agent/conversations/:id/messages')
  message(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChatMessageDto,
  ) {
    return this.conversations.post(id, user.id, dto.content);
  }
}
