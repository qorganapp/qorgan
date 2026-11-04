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

```bash
cp .env.example .env          # заполнить JWT_* и GITHUB_*
docker compose up --build
```

Локальная разработка: `docker compose up postgres redis`, затем `pnpm start:dev` (API) и
`pnpm build && node dist/worker.js` (воркер; сканеры должны быть в PATH — проще запускать
воркер в Docker).

### GitHub App

Permissions: *Contents: read & write*, *Pull requests: read & write*, *Metadata: read*.
Events: *Push*, *Pull request*, *Installation*, *Installation repositories*.
Запись нужна только агенту: он пушит ветки `qorgan/fix-*` и пишет ревью; в default-ветку
не пишет и ничего не мержит. Webhook URL: `<API>/api/github/webhook`. Setup URL: `<API>/api/github/setup`
с включённой опцией **Request user authorization (OAuth) during installation** — по ней API
проверяет, что установка принадлежит пользователю.

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

## Тесты

```bash
pnpm test
```

Фикстуры в `src/domains/scanner/__fixtures__` — реальный вывод сканеров на уязвимом тестовом
репозитории.
