import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { AGENT_QUEUE } from '../../../config/redis.config';
import { ChatJob, FixJob, MapJob, ReviewJob } from './agent-jobs';

const OPTS = { attempts: 1, removeOnComplete: 500, removeOnFail: 500 };

/** Постановка задач агенту. Нужна и API (чат), и вебхукам (ревью), и воркеру (фиксы). */
@Injectable()
export class AgentQueue {
  constructor(@InjectQueue(AGENT_QUEUE) private readonly queue: Queue) {}

  /** jobId из набора находок: один и тот же фикс не встанет в очередь дважды. */
  fix(job: FixJob) {
    const key = createHash('sha1')
      .update([...job.findingIds].sort().join(','))
      .digest('hex');
    return this.queue.add('fix', job, { ...OPTS, jobId: `fix-${key}` });
  }

  review(job: ReviewJob) {
    return this.queue.add('review', job, {
      ...OPTS,
      jobId: `review-${job.repositoryId}-${job.prNumber}-${job.headSha}`,
    });
  }

  chat(job: ChatJob) {
    return this.queue.add('chat', job, {
      ...OPTS,
      jobId: `chat-${job.messageId}`,
    });
  }

  /** Повторный запуск разрешён: от дублей защищает статус карты, а не jobId. */
  map(job: MapJob) {
    return this.queue.add('space-map', job, {
      ...OPTS,
      jobId: `map-${job.spaceId}-${Date.now()}`,
    });
  }
}
