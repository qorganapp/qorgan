# Qorgan — security-сканер репозиториев

Одна кнопка **Full Sweep** запускает все проверки репозитория из GitHub и выдаёт короткий
список «что исправить сейчас».

| Модуль | Что ищет | Инструменты |
|---|---|---|
| **Full Sweep** | Оркестратор + триаж: топ-6 действий | правила (`src/domains/triage`) |
| **Supply Chain** (`supply_chain`) | Уязвимые и вредоносные пакеты, тайпсквоттинг | osv-scanner, trivy fs, typosquat |
| **Code Audit** (`code_audit`) | Инъекции, SSRF, десериализация… | semgrep |
| **Secret Sweep** (`secrets`) | Ключи и токены в коде и истории git, проверка «живой ли» | gitleaks + `secret-probes.ts` |
| **Infra Guard** (`infra`) | Terraform / k8s / Dockerfile: публичные бакеты, root, `0.0.0.0/0` | checkov, trivy config |

## AI-агент

Агент работает как security-инженер в команде (`src/domains/agent`):

- **Триаж** — после каждого скана читает код вокруг находок и выносит вердикт (реальная /
  ложная / нужен контекст, достижимость, критичность для этого репозитория). Уверенные ложные
  срабатывания скрываются автоматически, приоритеты пересчитываются.
- **Фиксы через PR** — для подтверждённых пунктов «fix now» готовит минимальное исправление,
  перезапускает сканер (`verify_fix`) и только после этого открывает PR из ветки `qorgan/fix-*`.
- **Ревью PR** — на каждый PR сканирует только изменения и оставляет inline-комментарии;
  никогда не ставит approve.
- **Журнал** — каждый шаг агента сохраняется (`agent_runs`, `agent_steps`).
- **Пространства** — группа репозиториев пользователя (репозиторий может входить в несколько).
  Чат с агентом принадлежит пространству: агент читает код любого его репозитория
  (инструменты с аргументом `repo`, клон делается при первом обращении) и видит связи между ними.
- **Карта связей** — по кнопке: манифесты npm/Python дают связи «использует пакет» и «общая
  зависимость» (с пометкой уязвимых), затем агент ищет в коде вызовы между сервисами.

LLM подключается через `LlmProvider` (`LLM_PROVIDER`); первая реализация — Anthropic.
Код репозитория считается недоверенными данными, найденные секреты маскируются до отправки в
модель, CI-конфигурацию агент менять не может.

## Архитектура

```
GitHub App ─webhook─► API (src/main.ts) ─► Postgres
                        │ BullMQ
                        ▼
                      Redis ─► Worker (src/worker.ts, Dockerfile.worker со всеми сканерами)
                               clone → сканеры → нормализация → дедуп → триаж
```

Находки живут на уровне репозитория (`fingerprint`): повторная находка обновляется, исчезнувшая
становится `fixed` (только если её инструмент отработал успешно), `ignored` переживает сканы.

## Запуск

Весь стек поднимается из корня репозитория — см. [корневой README](../../README.md).

Локальная разработка: `make dev-deps` в корне (Postgres и Redis), `cp .env.example .env` здесь,
затем `pnpm start:dev` (API) и `pnpm build && node dist/worker.js` (воркер; сканеры должны быть
в PATH — проще запускать воркер в Docker: `docker compose up --build worker` из корня).

### GitHub App

Permissions: *Contents: read & write*, *Pull requests: read & write*, *Metadata: read*.
Events: *Push*, *Pull request*, *Installation*, *Installation repositories*.
Запись нужна только агенту: он пушит ветки `qorgan/fix-*` и пишет ревью; в default-ветку
не пишет и ничего не мержит. Webhook URL: `<API>/api/github/webhook`. Setup URL: `<API>/api/github/setup`
с включённой опцией **Request user authorization (OAuth) during installation** — по ней API
проверяет, что установка принадлежит пользователю.

## Продакшен

> Этот раздел описывает деплой из исходных репозиториев `qorgan-app-backend` и `qorgan-app`:
> продакшен пока собирается из них, CI монорепозитория образы не публикует и не деплоит.

Работает на `https://qorgan.shoqan.dev` (Ubuntu 24.04).

```
Caddy (TLS, Let's Encrypt) ── /api/* → 127.0.0.1:3000 (api)
                           └─ /*     → 127.0.0.1:8080 (web, репозиторий qorgan-app)
docker compose: api, worker, postgres, redis, web   (/opt/qorgan)
```

**CI/CD** (`.github/workflows/ci.yml`): на каждый push и PR — lint, тесты, сборка. На push в
`main` образы `api` и `worker` уходят в GHCR, затем job `deploy` заходит на сервер по SSH и
обновляет только свои сервисы. Ключ CI (секрет `DEPLOY_SSH_KEY`) ограничен forced command
`/opt/qorgan/deploy.sh`: он может только запустить `backend|web <sha>`, без shell и проброса портов.

**Секреты приложения** — только на сервере, в `/opt/qorgan/.env` (владелец `deploy`, 600), не в
GitHub. После изменения:

```
cd /opt/qorgan && sudo -u deploy docker compose --env-file .env --env-file tags.env up -d api worker
```

**Миграции** — при старте API (`DB_MIGRATE=true`). Новая миграция после изменения сущностей:
`pnpm migration:generate src/migrations/<Name>` (на локальной БД со схемой предыдущей версии).

## API

Все пути — с префиксом `/api`.

| Метод | Путь | |
|---|---|---|
| GET | `/github/install-url` | ссылка на установку App |
| GET | `/github/installations`, POST `/github/installations/:id/sync` | установки |
| GET | `/repositories`, `/repositories/:id` | репозитории |
| POST | `/repositories/:id/scans` | Full Sweep (или `{"modules":["secrets"]}`) |
| GET | `/repositories/:id/scans`, `/scans/:id` | сканы и статусы модулей |
| GET | `/scans/:id/summary` | Full Sweep: счётчики + `fixNow` |
| GET | `/scans/:id/findings`, `/repositories/:id/findings` | `?module=&severity=&status=&limit=&offset=` |
| PATCH | `/findings/:id` | `{"status":"ignored"\|"open"}` |
| GET, POST | `/spaces` | пространства; создание: `{"name":"…","repositoryIds":[…]}` |
| GET, PATCH, DELETE | `/spaces/:id` | пространство с репозиториями, переименование, удаление |
| POST | `/spaces/:id/repositories` | добавить: `{"repositoryIds":[…]}` |
| DELETE | `/spaces/:id/repositories/:repositoryId` | убрать репозиторий из пространства |
| GET | `/spaces/:id/overview` | сводка находок и последних сканов по репозиториям |
| GET | `/spaces/:id/graph`, POST `/spaces/:id/graph/refresh` | карта связей и её построение |
| GET, POST | `/spaces/:id/agent/conversations` | чаты пространства: `{"content":"…","repositoryId":null}` |
| GET | `/spaces/:id/agent/activity`, `/spaces/:id/agent/fixes` | действия агента и его PR по пространству |

## Тесты

```bash
pnpm test
```

Фикстуры в `src/domains/scanner/__fixtures__` — реальный вывод сканеров на уязвимом тестовом
репозитории.
