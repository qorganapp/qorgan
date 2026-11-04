import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AGENT_QUEUE } from '../../../config/redis.config';
import { AgentFixService } from '../agent-fix.service';
import { AgentJobName, FixJob } from './agent-jobs';

/** Задачи агента в воркере. По умолчанию по одной: фиксы и ревью тяжёлые и дорогие. */
@Processor(AGENT_QUEUE, {
  concurrency: Number(process.env.AGENT_CONCURRENCY ?? 1),
})
export class AgentProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentProcessor.name);

  constructor(private readonly fixes: AgentFixService) {
    super();
  }

  async process(job: Job<unknown, unknown, AgentJobName>): Promise<void> {
    switch (job.name) {
      case 'fix':
        return this.fixes.fix(job.data as FixJob);
      default:
        this.logger.warn(`Unknown agent job ${job.name}`);
    }
  }
}
