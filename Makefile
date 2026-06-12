# Service Hub — developer commands. The primary loop is no-Docker:
#   1) make db          (one-time: start local Postgres via podman)
#   2) make migrate
#   3) make run         (terminal A: Go API + always-ready /healthz on :8080)
#   4) make web-dev     (terminal B: Vite SPA on :5173, proxying /api to :8080)
# See README.md "Local development".

DATABASE_URL ?= postgres://servicehub:devpass@localhost:5432/servicehub?sslmode=disable
PG_CONTAINER ?= servicehub-pg
export DATABASE_URL

.DEFAULT_GOAL := help

.PHONY: help
help: ## List available targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## --- Database (podman) ---

.PHONY: db
db: ## Start (or resume) the local Postgres 17 container
	@podman start $(PG_CONTAINER) 2>/dev/null || \
	  podman run -d --name $(PG_CONTAINER) \
	    -e POSTGRES_USER=servicehub -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=servicehub \
	    -p 5432:5432 docker.io/library/postgres:17
	@echo "Postgres up on :5432 ($(PG_CONTAINER))"

.PHONY: db-stop
db-stop: ## Stop the local Postgres container
	@podman stop $(PG_CONTAINER)

OIDC_CONTAINER ?= servicehub-oidc
OIDC_TEST_ISSUER ?= http://127.0.0.1:8455/default
export OIDC_TEST_ISSUER

.PHONY: idp
idp: ## Start the mock OIDC IdP on :8455 (for `make run` and the auth test)
	@podman start $(OIDC_CONTAINER) 2>/dev/null || \
	  podman run -d --name $(OIDC_CONTAINER) -p 8455:8080 \
	    -e JSON_CONFIG="$$(cat dev/mock-oidc-config.json)" \
	    ghcr.io/navikt/mock-oauth2-server:2.1.10
	@echo "Mock OIDC up: $(OIDC_TEST_ISSUER) (use 127.0.0.1, not localhost)"

.PHONY: idp-stop
idp-stop: ## Stop the mock OIDC IdP
	@podman stop $(OIDC_CONTAINER)

.PHONY: migrate
migrate: ## Apply all migrations (goose up)
	go tool goose -dir migrations postgres "$(DATABASE_URL)" up

.PHONY: migrate-down
migrate-down: ## Roll back the last migration (goose down)
	go tool goose -dir migrations postgres "$(DATABASE_URL)" down

.PHONY: sqlc
sqlc: ## Regenerate type-safe queries from SQL
	go tool sqlc generate

.PHONY: seed
seed: ## Load dev catalog seed data (idempotent; dev only)
	podman exec -i $(PG_CONTAINER) psql -q -U servicehub -d servicehub < dev/seed.sql
	@echo "seeded dev catalog"

## --- Backend ---

.PHONY: run
run: ## Run the Go server (dev; SPA served by `make web-dev`)
	go run ./cmd/server

.PHONY: test
test: ## Run Go tests with the race detector
	go test -race ./...

.PHONY: lint
lint: ## Run golangci-lint (govet, staticcheck, gofmt, …)
	go tool golangci-lint run ./...

## --- Frontend (web-ui) ---

.PHONY: web-install
web-install: ## Install frontend dependencies
	cd web-ui && npm install

.PHONY: web-dev
web-dev: ## Run the Vite dev server (proxies /api to :8080)
	cd web-ui && npm run dev

.PHONY: web-build
web-build: ## Build the SPA to web-ui/dist
	cd web-ui && npm run build

.PHONY: web-check
web-check: ## Frontend typecheck + lint + tests
	cd web-ui && npm run typecheck && npm run lint && npm run test

## --- Embedded single-binary build ---

.PHONY: embed
embed: web-build ## Copy the built SPA into the Go embed dir
	rm -rf internal/web/dist/assets
	cp -r web-ui/dist/* internal/web/dist/

.PHONY: build
build: embed ## Build the single binary with the SPA embedded
	go build -o bin/server ./cmd/server
	@echo "built bin/server (SPA embedded)"

.PHONY: check
check: lint test web-check ## Run the full local gate (Go + frontend)

.PHONY: clean
clean: ## Remove build artifacts (keeps the committed placeholder index.html)
	rm -rf bin web-ui/dist internal/web/dist/assets
	git checkout -- internal/web/dist/index.html 2>/dev/null || true
