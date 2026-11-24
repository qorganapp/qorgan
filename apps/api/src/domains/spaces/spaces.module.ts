import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Finding } from '../findings/finding.entity';
import { RepositoriesModule } from '../repositories/repositories.module';
import { Scan } from '../scans/scan.entity';
import { SpaceGraph } from './space-graph.entity';
import { SpaceGraphService } from './space-graph.service';
import { SpaceRepository } from './space-repository.entity';
import { Space } from './space.entity';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Space,
      SpaceRepository,
      SpaceGraph,
      Finding,
      Scan,
    ]),
    RepositoriesModule,
  ],
  controllers: [SpacesController],
  providers: [SpacesService, SpaceGraphService],
  exports: [SpacesService, SpaceGraphService],
})
export class SpacesModule {}
