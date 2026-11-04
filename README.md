# Qorgan Web

Angular-фронтенд Qorgan — security-сканера репозиториев в стиле CleanMyMac:
одна кнопка **Full Sweep**, анимация сканирования по модулям и короткий список
«N things to fix now».

Бэкенд: [qorgan-app-backend](https://github.com/qorganapp/qorgan-app-backend).

## Запуск

Нужна Node 24 (`.nvmrc`).

```bash
pnpm install
pnpm start            # http://localhost:4200, /api проксируется на http://localhost:3000
```

### Демо без бэкенда

Откройте `http://localhost:4200/?mock=1` — встроенный mock-бэкенд отдаёт реальные результаты
сканеров на тестовом уязвимом репозитории и симулирует прогресс скана. Подходит любой логин.
`?mock=0` выключает демо-режим. В production-сборке mock-код лежит в отдельном ленивом чанке
и загружается только в демо-режиме.

## Структура

```
src/app/
  core/api/       типы API, QorganApi (все запросы), Auth (токен в памяти, refresh-cookie)
  core/http/      authInterceptor (один refresh на пачку 401), mockInterceptor
  core/state/     RepoContext (выбранный репозиторий), ScanSession (скан, polling, сводка)
  core/mock/      демо-бэкенд и фикстуры
  shared/         module-meta (названия/цвета/иконки модулей), иконки, бейджи, scan-orb
  features/       auth, shell, full-sweep, module, repositories
```

Цвет интерфейса задаётся активным разделом (`module-meta.ts` → CSS-переменные
`--accent-a/--accent-b`). Тёмная тема по умолчанию, светлая — по системной настройке.

## Тесты

```bash
pnpm test -- --watch=false
```
