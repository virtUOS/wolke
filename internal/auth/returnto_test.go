package auth

import "testing"

// sanitizeReturnTo must only ever produce a same-origin path. Browsers strip
// ASCII tab/newline when parsing a Location URL (WHATWG URL preprocessing), so
// "/\t/evil.com" would reach the browser as the protocol-relative
// "//evil.com" — control characters are as dangerous as a literal "//".
func TestSanitizeReturnTo(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", "/"},
		{"plain path", "/settings", "/settings"},
		{"path with query", "/search?q=zoom", "/search?q=zoom"},
		{"absolute URL", "https://evil.com", "/"},
		{"protocol-relative", "//evil.com", "/"},
		{"backslash variant", "/\\evil.com", "/"},
		{"tab smuggles protocol-relative", "/\t/evil.com", "/"},
		{"newline", "/\n/evil.com", "/"},
		{"carriage return", "/\r/evil.com", "/"},
		{"vertical tab", "/\v/evil.com", "/"},
		{"delete char", "/\x7f/evil.com", "/"},
		{"tab later in path", "/a\tb", "/"},
		{"no leading slash", "settings", "/"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sanitizeReturnTo(tc.in); got != tc.want {
				t.Errorf("sanitizeReturnTo(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
