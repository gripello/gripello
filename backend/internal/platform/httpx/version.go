package httpx

import (
	"net/http"
	"regexp"
	"strconv"
)

const VersionHeader = "X-Gripello-Api-Version"

type Outcome int

const (
	OK Outcome = iota
	Outdated
	Unsupported
)

var semverPrefix = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)`)

func ParseSemver(s string) (major, minor, patch int, ok bool) {
	m := semverPrefix.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, 0, false
	}
	major, _ = strconv.Atoi(m[1])
	minor, _ = strconv.Atoi(m[2])
	patch, _ = strconv.Atoi(m[3])
	return major, minor, patch, true
}

func Check(client, server string) Outcome {
	cMajor, cMinor, cPatch, cOK := ParseSemver(client)
	sMajor, sMinor, sPatch, sOK := ParseSemver(server)
	switch {
	case !cOK || !sOK:
		return OK
	case cMajor != sMajor || cMinor > sMinor:
		return Unsupported
	case cMinor != sMinor || cPatch != sPatch:
		return Outdated
	}
	return OK
}

func Versioned(server string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set(VersionHeader, server)
			if Check(r.Header.Get(VersionHeader), server) == Unsupported {
				Fail(w, NewError(400, "Unsupported API version").Field("version", "unsupported_version", "Client version is not supported by this server"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
