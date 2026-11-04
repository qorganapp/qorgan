import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RepositoriesService } from '../repositories/repositories.service';
import { CreateScanDto } from './dto/create-scan.dto';
import { ScanTrigger } from './scan.entity';
import { ScansService } from './scans.service';

@Controller()
export class ScansController {
  constructor(
    private readonly scans: ScansService,
    private readonly repositories: RepositoriesService,
  ) {}

  /** Full Sweep по умолчанию; можно запустить только выбранные модули. */
  @Post('repositories/:id/scans')
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateScanDto,
  ) {
    const repo = await this.repositories.findOwned(id, user.id);
    return this.scans.enqueue(repo, {
      trigger: ScanTrigger.Manual,
      modules: dto.modules,
    });
  }

  @Get('repositories/:id/scans')
  async list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const repo = await this.repositories.findOwned(id, user.id);
    return this.scans.listForRepository(repo.id);
  }

  @Get('scans/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scans.findOwned(id, user.id);
  }
}
