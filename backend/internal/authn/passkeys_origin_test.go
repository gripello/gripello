package authn

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
)

func TestAndroidPasskeyCertsMatchAssetLinks(t *testing.T) {
	raw, err := os.ReadFile("../../../public/.well-known/assetlinks.json")
	if err != nil {
		t.Fatal(err)
	}
	var statements []struct {
		Relation []string `json:"relation"`
		Target   struct {
			Fingerprints []string `json:"sha256_cert_fingerprints"`
		} `json:"target"`
	}
	if err := json.Unmarshal(raw, &statements); err != nil {
		t.Fatal(err)
	}
	for _, statement := range statements {
		if slices.Contains(statement.Relation, "delegate_permission/common.get_login_creds") {
			if !slices.Equal(statement.Target.Fingerprints, AndroidPasskeyCerts) {
				t.Fatalf("assetlinks get_login_creds %v, Go %v", statement.Target.Fingerprints, AndroidPasskeyCerts)
			}
			return
		}
	}
	t.Fatal("assetlinks.json has no get_login_creds statement")
}

func TestPasskeysAcceptTheAndroidAppOrigin(t *testing.T) {
	rp, err := buildRelyingParty("https://gripello.app", "Gripello")
	if err != nil {
		t.Fatal(err)
	}
	app := "android:apk-key-hash:klzdnnypKqszWQ4rAH3ouIQiXjeMNrM8KoDqAPZ-vrE" // gitleaks:allow (public signing cert hash)
	client := protocol.CollectedClientData{Type: protocol.AssertCeremony, Challenge: "c", Origin: app}
	if err := client.Verify("c", protocol.AssertCeremony, rp.Config.RPOrigins, rp.Config.RPOpaqueOrigins, nil, protocol.TopOriginDefaultVerificationMode, false); err != nil {
		t.Fatalf("app origin rejected: %v", err)
	}
	client.Origin = "android:apk-key-hash:someone-else"
	if err := client.Verify("c", protocol.AssertCeremony, rp.Config.RPOrigins, rp.Config.RPOpaqueOrigins, nil, protocol.TopOriginDefaultVerificationMode, false); err == nil {
		t.Fatal("foreign app origin accepted")
	}
}
