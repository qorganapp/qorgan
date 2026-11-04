import { Module } from '@nestjs/common';
import { FindingsModule } from '../findings/findings.module';
import { GithubModule } from '../github/github.module';
import { ScansModule } from '../scans/scans.module';
import { ScanProcessor } from './scan.processor';
import { SecretValidator } from './secret-validator';

/** Подключается только в воркере (src/worker.ts). */
@Module({
  imports: [ScansModule, FindingsModule, GithubModule],
  providers: [ScanProcessor, SecretValidator],
})
export class ScannerModule {}
