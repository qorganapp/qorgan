import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { FindingsModule } from '../findings/findings.module';
import { GithubModule } from '../github/github.module';
import { ScansModule } from '../scans/scans.module';
import { ScanProcessor } from './scan.processor';
import { SecretValidator } from './secret-validator';

/** Подключается только в воркере (src/worker.ts). */
@Module({
  imports: [ScansModule, FindingsModule, GithubModule, AgentModule],
  providers: [ScanProcessor, SecretValidator],
})
export class ScannerModule {}
