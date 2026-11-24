import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SCANS_QUEUE } from '../../config/redis.config';
import { RepositoriesModule } from '../repositories/repositories.module';
import { ScanModuleRun } from './scan-module-run.entity';
import { Scan } from './scan.entity';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Scan, ScanModuleRun]),
    BullModule.registerQueue({ name: SCANS_QUEUE }),
    RepositoriesModule,
  ],
  controllers: [ScansController],
  providers: [ScansService],
  exports: [ScansService],
})
export class ScansModule {}
