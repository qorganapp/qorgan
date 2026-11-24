import { Module } from '@nestjs/common';
import { coreImports } from './app.module';
import { ScannerModule } from './domains/scanner/scanner.module';

@Module({ imports: [...coreImports, ScannerModule] })
export class WorkerModule {}
