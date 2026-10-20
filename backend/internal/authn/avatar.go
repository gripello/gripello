package authn

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"syscall"
	"time"

	"gripello/internal/platform/blob"
)

var (
	avatarClient = &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{
		DialContext:         (&net.Dialer{Timeout: 5 * time.Second, Control: publicHostsOnly}).DialContext,
		TLSHandshakeTimeout: 5 * time.Second,
	}}
	microsoftPhotoURL = "https://graph.microsoft.com/v1.0/me/photos/240x240/$value"
	avatarExtensions  = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}
)

const maxAvatarBytes = 5 << 20

// publicHostsOnly keeps picture URLs from an identity provider away from the internal network (also after redirects).
func publicHostsOnly(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip, err := netip.ParseAddr(host)
	if ip = ip.Unmap(); err != nil || !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return errors.New("avatar host is not public")
	}
	return nil
}

// importAvatar copies the provider's profile picture into a new account; a failure only costs the picture.
func (m *module) importAvatar(ctx context.Context, provider, userID string, claims identityClaims) {
	source, bearer := claims.Picture, ""
	if provider == "microsoft" {
		source, bearer = microsoftPhotoURL, claims.accessToken
	}
	if !strings.HasPrefix(source, "https://") {
		return
	}
	if provider == "google" {
		source = strings.Replace(source, "=s96-c", "=s400-c", 1)
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := avatarClient.Do(req)
	if err != nil {
		slog.Warn("oauth2 avatar download failed", "provider", provider, "err", err)
		return
	}
	defer res.Body.Close()
	ext, ok := avatarExtensions[strings.TrimSpace(strings.Split(res.Header.Get("Content-Type"), ";")[0])]
	if res.StatusCode != http.StatusOK || !ok {
		return
	}
	name, err := m.blob.Upload(ctx, "users/"+userID+"/avatar"+ext, res.Body, []string{"image/jpeg", "image/png", "image/gif", "image/webp"}, maxAvatarBytes)
	if err != nil {
		slog.Warn("oauth2 avatar rejected", "provider", provider, "err", err)
		return
	}
	key := "users/" + userID + "/" + name
	if _, err := m.db.Exec(ctx, `UPDATE users SET avatar = $1 WHERE id = $2 AND avatar = ''`, name, userID); err != nil {
		m.blob.Delete(context.WithoutCancel(ctx), key)
		return
	}
	m.blob.WarmThumbs(key, blob.UserThumbs["avatar"]...)
}
