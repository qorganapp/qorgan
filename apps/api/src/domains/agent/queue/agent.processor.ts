import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AGENT_QUEUE } from '../../../config/redis.config';
import { AgentChatService } from '../agent-chat.service';
import { AgentFixService } from '../agent-fix.service';
import { AgentMapService } from '../agent-map.service';
import { AgentReviewService } from '../agent-review.service';
import { AgentJobName, ChatJob, FixJob, MapJob, ReviewJob } from './agent-jobs';

/** Задачи агента в воркере. По умолчанию по одной: фиксы и ревью тяжёлые и дорогие. */
@Processor(AGENT_QUEUE, {
  concurrency: Number(process.env.AGENT_CONCURRENCY ?? 1),
})
export class AgentProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentProcessor.name);

  constructor(
    private readonly fixes: AgentFixService,
    private readonly reviews: AgentReviewService,
    private readonly chat: AgentChatService,
    private readonly maps: AgentMapService,
  ) {
    super();
  }

  async process(job: Job<unknown, unknown, AgentJobName>): Promise<void> {
    switch (job.name) {
      case 'fix':
        return this.fixes.fix(job.data as FixJob);
      case 'review':
        return this.reviews.review(job.data as ReviewJob);
      case 'chat':
        return this.chat.answer(job.data as ChatJob);
      case 'space-map':
        return this.maps.build(job.data as MapJob);
      default:
        this.logger.warn(`Unknown agent job ${String(job.name)}`);
    }
  }
}
