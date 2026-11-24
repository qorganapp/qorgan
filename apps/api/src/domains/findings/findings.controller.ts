import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RepositoriesService } from '../repositories/repositories.service';
import { ScansService } from '../scans/scans.service';
import { ListFindingsQuery } from './dto/list-findings.query';
import { UpdateFindingDto } from './dto/update-finding.dto';
import { FindingsService } from './findings.service';

@Controller()
export class FindingsController {
  constructor(
    private readonly findings: FindingsService,
    private readonly scans: ScansService,
    private readonly repositories: RepositoriesService,
  ) {}

  @Get('scans/:id/summary')
  async summary(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.findings.summary(await this.scans.findOwned(id, user.id));
  }

  @Get('scans/:id/findings')
  async forScan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListFindingsQuery,
  ) {
    const scan = await this.scans.findOwned(id, user.id);
    return this.findings.listForScan(scan.id, query);
  }

  /** Текущее состояние репозитория (по умолчанию — только открытые). */
  @Get('repositories/:id/findings')
  async forRepository(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListFindingsQuery,
  ) {
    const repo = await this.repositories.findOwned(id, user.id);
    return this.findings.listForRepository(repo.id, query);
  }

  @Patch('findings/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFindingDto,
  ) {
    return this.findings.updateStatus(id, user.id, dto.status);
  }
}
