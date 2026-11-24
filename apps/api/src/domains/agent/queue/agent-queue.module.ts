import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AGENT_QUEUE } from '../../../config/redis.config';
import { AgentQueue } from './agent-queue';

@Module({
  imports: [BullModule.registerQueue({ name: AGENT_QUEUE })],
  providers: [AgentQueue],
  exports: [AgentQueue],
})
export class AgentQueueModule {}
