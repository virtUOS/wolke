package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"
)

// healthcheck is the container probe (used by the Dockerfile HEALTHCHECK and the
// Compose healthcheck). It runs the same binary with the "healthcheck" argument
// — distroless has no shell or curl, so the binary probes itself. It hits the
// local /readyz so an orchestrator gates on real readiness (DB reachable), not
// just process liveness. Exit 0 = ready, non-zero = not ready.
func healthcheck() error {
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		// addr may be a bare ":8080"; SplitHostPort handles that, so a failure
		// here means a genuinely malformed value.
		return fmt.Errorf("parse HTTP_ADDR %q: %w", addr, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	url := fmt.Sprintf("http://127.0.0.1:%s/readyz", port)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("not ready: %s", resp.Status)
	}
	return nil
}
