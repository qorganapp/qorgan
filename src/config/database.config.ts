import { ConfigService } from '@nestjs/config';
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
  synchronize: config.get('NODE_ENV') !== 'production',
});
