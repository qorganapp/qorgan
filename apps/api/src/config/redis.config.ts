import { ConfigService } from '@nestjs/config';
import type { QueueOptions } from 'bullmq';

export const SCANS_QUEUE = 'scans';
export const AGENT_QUEUE = 'agent';

export const redisConfig = (config: ConfigService): QueueOptions => {
  const url = new URL(config.get('REDIS_URL', 'redis://localhost:6379'));
  return {
    connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
      tls: url.protocol === 'rediss:' ? {} : undefined,
    },
  };
};
