import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RepositoriesService } from '../repositories/repositories.service';
import { SpaceGraphService } from '../spaces/space-graph.service';
import { SpacesService } from '../spaces/spaces.service';
import { AgentConversationsService } from './agent-conversations.service';
import { AgentFix } from './agent-fix.entity';
import { AgentRunsService } from './agent-runs.service';
import { AgentSettingsDto, ChatMessageDto } from './dto/agent.dto';
import { LLM_PROVIDER, LlmProvider } from './llm/llm-provider';
import { AgentQueue } from './queue/agent-queue';

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
    private readonly spaces: SpacesService,
    private readonly graphs: SpaceGraphService,
    private readonly queue: AgentQueue,
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

  @Get('spaces/:id/agent/conversations')
  async conversationsList(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const space = await this.spaces.findOwned(id, user.id);
    return this.conversations.list(space.id, user.id);
  }

  @Post('spaces/:id/agent/conversations')
  async startConversation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChatMessageDto,
  ) {
    const space = await this.spaces.findOwned(id, user.id);
    const focus = await this.focusIn(space.id, dto.repositoryId);
    return this.conversations.start(
      space.id,
      user.id,
      dto.content,
      focus ?? null,
    );
  }

  /** Всё, что агент делал в пространстве и по его репозиториям. */
  @Get('spaces/:id/agent/activity')
  async spaceActivity(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const space = await this.spaces.findOwned(id, user.id);
    const repos = await this.spaces.repositoriesOf(space.id);
    return this.runs.listForSpace(
      space.id,
      repos.map((r) => r.id),
    );
  }

  @Get('spaces/:id/agent/fixes')
  async spaceFixes(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const space = await this.spaces.findOwned(id, user.id);
    const repos = await this.spaces.repositoriesOf(space.id);
    if (!repos.length) return [];
    return this.fixes.find({
      where: { repositoryId: In(repos.map((r) => r.id)) },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /** Карта связей между репозиториями пространства — последняя построенная. */
  @Get('spaces/:id/graph')
  async graph(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.graphs.view(await this.spaces.findOwned(id, user.id));
  }

  /** Строит карту заново. Пока идёт построение, повторный запрос ничего не запускает. */
  @Post('spaces/:id/graph/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  async refreshGraph(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const space = await this.spaces.findOwned(id, user.id);
    if ((await this.graphs.view(space)).status !== 'running') {
      await this.graphs.begin(space.id);
      await this.queue.map({ spaceId: space.id });
    }
    return this.graphs.view(space);
  }

  @Get('agent/conversations/:id')
  conversation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversations.get(id, user.id);
  }

  @Post('agent/conversations/:id/messages')
  async message(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChatMessageDto,
  ) {
    const conversation = await this.conversations.get(id, user.id);
    const focus = await this.focusIn(conversation.spaceId, dto.repositoryId);
    return this.conversations.post(id, user.id, dto.content, focus);
  }

  /** Фокус вопроса должен быть репозиторием того же пространства. */
  private async focusIn(
    spaceId: string | null,
    repositoryId: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (!repositoryId) return repositoryId;
    if (!spaceId || !(await this.spaces.contains(spaceId, repositoryId)))
      throw new NotFoundException('Repository not found in this space');
    return repositoryId;
  }
}
