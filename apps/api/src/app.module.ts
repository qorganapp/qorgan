import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { databaseConfig } from './config/database.config';
import { redisConfig } from './config/redis.config';
import { AgentModule } from './domains/agent/agent.module';
import { AuthModule } from './domains/auth/auth.module';
import { AccessTokenGuard } from './domains/auth/guards/access-token.guard';
import { FindingsModule } from './domains/findings/findings.module';
import { GithubModule } from './domains/github/github.module';
import { RepositoriesModule } from './domains/repositories/repositories.module';
import { ScansModule } from './domains/scans/scans.module';
import { SpacesModule } from './domains/spaces/spaces.module';
import { UsersModule } from './domains/users/users.module';

/** Общая инфраструктура API и воркера. */
export const coreImports = [
  ConfigModule.forRoot({ isGlobal: true }),
  TypeOrmModule.forRootAsync({
    inject: [ConfigService],
    useFactory: databaseConfig,
  }),
  BullModule.forRootAsync({ inject: [ConfigService], useFactory: redisConfig }),
];

@Module({
  imports: [
    ...coreImports,
    UsersModule,
    AuthModule,
    GithubModule,
    RepositoriesModule,
    ScansModule,
    FindingsModule,
    SpacesModule,
    AgentModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: AccessTokenGuard }],
})
export class AppModule {}
