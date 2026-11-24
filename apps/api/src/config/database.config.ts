import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig = (
  config: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: config.get('DB_HOST', 'localhost'),
  port: Number(config.get('DB_PORT', 5432)),
  username: config.get('DB_USER', 'postgres'),
  password: config.get('DB_PASSWORD', 'postgres'),
  database: config.get('DB_NAME', 'qorgan'),
  autoLoadEntities: true,
  // В проде схема меняется только миграциями; synchronize — для локальной разработки.
  synchronize: config.get('NODE_ENV') !== 'production',
  migrations: [join(__dirname, '..', 'migrations', '*.js')],
  // Миграции запускает только API (DB_MIGRATE=true), чтобы воркер не гонялся с ним.
  migrationsRun: config.get('DB_MIGRATE') === 'true',
});
