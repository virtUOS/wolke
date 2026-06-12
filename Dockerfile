# Multi-stage build → one small app image (docs/04 §4). Stage 1 builds the SPA,
# stage 2 builds the Go binary with the SPA embedded, the final stage is a
# distroless runtime carrying just the binary and the default branding assets.

# --- Stage 1: build the React SPA ---
FROM docker.io/library/node:24-alpine AS web
WORKDIR /web
COPY web-ui/package.json web-ui/package-lock.json ./
RUN npm ci
COPY web-ui/ ./
RUN npm run build

# --- Stage 2: build the Go binary (embeds the SPA) ---
FROM docker.io/library/golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Overlay the built SPA onto the committed placeholder, then embed it.
COPY --from=web /web/dist/ internal/web/dist/
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server
# goose binary for the one-shot migrate service (forward-only, run on deploy).
RUN CGO_ENABLED=0 go build -o /out/goose github.com/pressly/goose/v3/cmd/goose

# --- Final: distroless runtime ---
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
COPY --from=build /out/server /server
COPY branding/ /branding/
ENV BRANDING_DIR=/branding
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
