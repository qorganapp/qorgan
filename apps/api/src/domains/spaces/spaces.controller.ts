import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AddRepositoriesDto,
  CreateSpaceDto,
  UpdateSpaceDto,
} from './dto/space.dto';
import { SpacesService } from './spaces.service';

@Controller('spaces')
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.spaces.listOwned(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSpaceDto) {
    return this.spaces.create(user.id, dto.name, dto.repositoryIds);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.spaces.detail(id, user.id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpaceDto,
  ) {
    return this.spaces.rename(id, user.id, dto.name);
  }

  /** Удаляет только пространство: репозитории, сканы и находки остаются. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.spaces.remove(id, user.id);
  }

  @Post(':id/repositories')
  @HttpCode(HttpStatus.OK)
  addRepositories(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddRepositoriesDto,
  ) {
    return this.spaces.addRepositories(id, user.id, dto.repositoryIds);
  }

  @Delete(':id/repositories/:repositoryId')
  removeRepository(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    return this.spaces.removeRepository(id, user.id, repositoryId);
  }

  @Get(':id/overview')
  overview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.spaces.overview(id, user.id);
  }
}
