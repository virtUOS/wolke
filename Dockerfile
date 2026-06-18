# Multi-stage build → one small image (docs/04 §4). Stage 1 builds the SPA, stage
# 2 builds the Go binary with the SPA embedded, and the final `runtime` stage is a
# distroless image carrying just the server binary and default branding. The
# server embeds the SQL migrations and applies them itself on startup, so there's
# no separate migrate image.
#
# BuildKit cache mounts (--mount=type=cache) keep the npm and Go caches warm
# across rebuilds.

# --- Stage 1: build the React SPA ---
FROM docker.io/library/node:26-alpine AS web
WORKDIR /web
COPY web-ui/package.json web-ui/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web-ui/ ./
RUN npm run build

# --- Stage 2: build the Go binary (server embeds the SPA + the SQL migrations) ---
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

# --- runtime: distroless app image ---
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
