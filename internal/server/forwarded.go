package server

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
)

type ctxKey int

const forwardedCtxKey ctxKey = iota

// Forwarded is the effective request origin after applying trusted-proxy
// X-Forwarded-* headers. The app serves plain HTTP inside the Compose network,
// so it learns the real client protocol/host from Caddy via these headers — but
// only when the direct peer is a trusted proxy (docs/02 §3, §10).
type Forwarded struct {
	Scheme   string // "http" or "https"
	Host     string
	ClientIP string
}

// TrustedProxies is the set of peer addresses permitted to set X-Forwarded-*.
type TrustedProxies struct {
	nets []*net.IPNet
}

// NewTrustedProxies parses CIDRs (and bare IPs, treated as single-host) into a
// trust set. An empty list trusts nobody — correct for local dev with no proxy.
func NewTrustedProxies(entries []string) (*TrustedProxies, error) {
	tp := &TrustedProxies{}
	for _, e := range entries {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		if _, n, err := net.ParseCIDR(e); err == nil {
			tp.nets = append(tp.nets, n)
			continue
		}
		ip := net.ParseIP(e)
		if ip == nil {
			return nil, fmt.Errorf("trusted proxy %q is not a valid CIDR or IP", e)
		}
		bits := 32
		if ip.To4() == nil {
			bits = 128
		}
		tp.nets = append(tp.nets, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
	}
	return tp, nil
}

func (tp *TrustedProxies) trusts(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, n := range tp.nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// Forwarded is middleware that computes the effective request origin and stores
// it in the context. Headers from an untrusted peer are ignored entirely, so a
// client cannot spoof its protocol or host.
func (tp *TrustedProxies) Forwarded() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fwd := Forwarded{
				Scheme:   schemeOf(r),
				Host:     r.Host,
				ClientIP: hostOnly(r.RemoteAddr),
			}
			if tp.trusts(r.RemoteAddr) {
				if v := firstToken(r.Header.Get("X-Forwarded-Proto")); v != "" {
					fwd.Scheme = v
				}
				if v := firstToken(r.Header.Get("X-Forwarded-Host")); v != "" {
					fwd.Host = v
				}
				if v := firstToken(r.Header.Get("X-Forwarded-For")); v != "" {
					fwd.ClientIP = v
				}
			}
			ctx := context.WithValue(r.Context(), forwardedCtxKey, fwd)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ForwardedFromContext returns the effective origin, or a zero value if the
// middleware did not run.
func ForwardedFromContext(ctx context.Context) Forwarded {
	if f, ok := ctx.Value(forwardedCtxKey).(Forwarded); ok {
		return f
	}
	return Forwarded{}
}

func schemeOf(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

func hostOnly(remoteAddr string) string {
	if h, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return h
	}
	return remoteAddr
}

// firstToken returns the first comma-separated, trimmed token (X-Forwarded-For
// may list multiple hops; the first is the original client).
func firstToken(s string) string {
	if s == "" {
		return ""
	}
	if i := strings.IndexByte(s, ','); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}
