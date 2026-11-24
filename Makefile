.PHONY: help env up down logs ps install dev-deps dev-api dev-web test lint build

help: ## Показать команды
	@grep -E "^[a-z-]+:.*##" $(MAKEFILE_LIST) | sed -E "s/:.*## /  —  /"

env: .env ## Создать .env со случайными JWT-секретами

.env:
	@sed -e "s/^JWT_ACCESS_SECRET=.*/JWT_ACCESS_SECRET=$$(openssl rand -hex 32)/" \
	     -e "s/^JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$$(openssl rand -hex 32)/" \
	     .env.example > .env
	@echo "Создан .env"

up: .env ## Собрать и поднять всё: http://localhost:8080
	docker compose up --build -d --wait
	@echo "Qorgan: http://localhost:8080  (демо без GitHub: /?mock=1)"

down: ## Остановить
	docker compose down

logs: ## Логи всех сервисов
	docker compose logs -f

ps: ## Состояние сервисов
	docker compose ps

install: ## Установить зависимости для локальной разработки
	pnpm install

dev-deps: ## Только Postgres и Redis (порты на 127.0.0.1)
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis

dev-api: ## API в watch-режиме (нужен apps/api/.env)
	pnpm dev:api

dev-web: ## Фронтенд на http://localhost:4200
	pnpm dev:web

test: ## Тесты API и фронтенда
	pnpm test

lint: ## Линтер API
	pnpm lint

build: ## Сборка обоих приложений
	pnpm build
