# Multi-stage build → small images (docs/04 §4). Stage 1 builds the SPA, stage 2
# builds the Go binaries with the SPA embedded; the final `runtime` stage is a
# distroless image carrying just the server binary and default branding, and the
# `migrate` stage is a distroless image carrying just goose + the migrations.
#
# BuildKit cache mounts (--mount=type=cache) keep the npm and Go caches warm
# across rebuilds. `runtime` is the last stage, so it is the default build target
# (what CI's build-push publishes); `migrate` is selected explicitly by Compose.

# --- Stage 1: build the React SPA ---
FROM docker.io/library/node:24-alpine AS web
WORKDIR /web
COPY web-ui/package.json web-ui/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web-ui/ ./
RUN npm run build

# --- Stage 2: build the Go binaries (server embeds the SPA) ---
FROM docker.io/library/golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
# Overlay the built SPA onto the committed placeholder, then embed it.
COPY --from=web /web/dist/ internal/web/dist/
# -s -w strips the symbol table/DWARF (smaller binary); -trimpath removes host
# paths for reproducible builds.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server
# goose binary for the one-shot migrate service (forward-only, run on deploy).
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/goose github.com/pressly/goose/v3/cmd/goose

# --- migrate: tiny image that runs goose against the DB on deploy ---
# Carries only the goose binary and the SQL migrations — no compiler, no source.
FROM gcr.io/distroless/static-debian12:nonroot AS migrate
COPY --from=build /out/goose /goose
COPY migrations/ /migrations/
ENTRYPOINT ["/goose", "-dir", "/migrations"]

# --- runtime: distroless app image (default build target) ---
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
COPY --from=build /out/server /server
COPY branding/ /branding/
ENV BRANDING_DIR=/branding
EXPOSE 8080
USER nonroot:nonroot
# The binary probes itself (distroless has no shell/curl); gates on /readyz.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/server", "healthcheck"]
ENTRYPOINT ["/server"]
