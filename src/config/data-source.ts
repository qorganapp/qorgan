import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

/**
 * DataSource для TypeORM CLI (генерация и запуск миграций) — работает на собранном `dist`.
 * Приложение подключается к БД через `database.config.ts` с теми же переменными окружения.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'qorgan',
  entities: [join(__dirname, '..', '**', '*.entity.js')],
  migrations: [join(__dirname, '..', 'migrations', '*.js')],
});
