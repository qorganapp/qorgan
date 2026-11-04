import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RepositoriesModule } from '../repositories/repositories.module';
import { ScansModule } from '../scans/scans.module';
import { GithubAppService } from './github-app.service';
import { GithubInstallation } from './github-installation.entity';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([GithubInstallation]),
    JwtModule.register({}),
    RepositoriesModule,
    ScansModule,
  ],
  controllers: [GithubController],
  providers: [GithubAppService, GithubService],
  exports: [GithubAppService],
})
export class GithubModule {}
