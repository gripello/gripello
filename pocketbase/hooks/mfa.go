package hooks

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/spf13/cast"
)

var errFactorRejected = errors.New("second factor rejected")

const (
	recoveryCodeCount = 10
	mfaSessionTTL     = 10 * time.Minute
)

const (
	mfaMethodTOTP     = "totp"
	mfaMethodPasskey  = "passkey"
	mfaMethodRecovery = "recovery"
)

func registerMFA(app core.App) {
	app.OnRecordAuthRequest("users").Bind(&hook.Handler[*core.RecordAuthRequestEvent]{Priority: -1, Func: enforceSecondFactor})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		signedIn := apis.RequireAuth("users")
		se.Router.GET("/api/account/mfa", listMFAFactors).Bind(signedIn)
		se.Router.DELETE("/api/account/mfa/{id}", deleteMFAFactor).Bind(signedIn)
		se.Router.PATCH("/api/account/mfa/{id}", renameMFAFactor).Bind(signedIn)
		se.Router.POST("/api/account/totp/setup", totpSetup).Bind(signedIn)
		se.Router.POST("/api/account/totp", totpEnable).Bind(signedIn)
		se.Router.POST("/api/account/recovery-codes", regenerateRecoveryCodes).Bind(signedIn)
		se.Router.POST("/api/auth/totp", authWithTOTP)
		se.Router.POST("/api/auth/recovery", authWithRecoveryCode)
		return se.Next()
	})
}

func isSecondFactor(method string) bool {
	return method == mfaMethodTOTP || method == mfaMethodPasskey || method == mfaMethodRecovery
}

// Mirrors PocketBase's checkMFA, which needs two built-in auth methods enabled on the collection.
func enforceSecondFactor(e *core.RecordAuthRequestEvent) error {
	if e.AuthMethod == "" || e.Get(passkeyLoginFlag) == true || len(mfaFactors(e.App, e.Record.Id)) == 0 {
		return e.Next()
	}
	info, err := e.RequestInfo()
	if err != nil {
		return err
	}
	mfaID := firstNonEmpty(e.Request.URL.Query().Get("mfaId"), cast.ToString(info.Body["mfaId"]))
	if mfaID == "" {
		if isSecondFactor(e.AuthMethod) {
			return e.BadRequestError("Invalid MFA session.", nil)
		}
		mfa := core.NewMFA(e.App)
		mfa.SetCollectionRef(e.Record.Collection().Id)
		mfa.SetRecordRef(e.Record.Id)
		mfa.SetMethod(e.AuthMethod)
		if err := e.App.Save(mfa); err != nil {
			return e.InternalServerError("Failed to create MFA record", err)
		}
		_ = e.JSON(http.StatusUnauthorized, map[string]any{"mfaId": mfa.Id, "methods": secondFactorMethods(e.App, e.Record.Id)})
		return apis.ErrMFA
	}
	mfa, err := e.App.FindMFAById(mfaID)
	if err != nil || mfa.HasExpired(mfaSessionTTL) || mfa.RecordRef() != e.Record.Id || mfa.CollectionRef() != e.Record.Collection().Id {
		return e.BadRequestError("Invalid or expired MFA session.", err)
	}
	if mfa.Method() == e.AuthMethod || !isSecondFactor(e.AuthMethod) {
		return e.BadRequestError("A different authentication method is required.", nil)
	}
	if err := e.App.Delete(mfa); err != nil {
		return e.InternalServerError("", err)
	}
	return e.Next()
}

func secondFactorMethods(app core.App, userID string) []string {
	kinds := map[string]bool{}
	for _, factor := range mfaFactors(app, userID) {
		kinds[factor.GetString("kind")] = true
	}
	methods := []string{}
	for _, method := range []string{mfaMethodTOTP, mfaMethodPasskey} {
		if kinds[method] {
			methods = append(methods, method)
		}
	}
	if len(recoveryCodeHashes(app, userID)) > 0 {
		methods = append(methods, mfaMethodRecovery)
	}
	return methods
}

func mfaFactors(app core.App, userID string) []*core.Record {
	factors, err := app.FindRecordsByFilter("mfa_factors", "user = {:user}", "created", 0, 0, dbx.Params{"user": userID})
	if err != nil {
		return nil
	}
	return factors
}

func factorSummary(factor *core.Record) map[string]any {
	return map[string]any{
		"id":        factor.Id,
		"kind":      factor.GetString("kind"),
		"name":      factor.GetString("name"),
		"created":   factor.GetDateTime("created"),
		"last_used": factor.GetDateTime("last_used"),
	}
}

func listMFAFactors(e *core.RequestEvent) error {
	factors := []map[string]any{}
	for _, factor := range mfaFactors(e.App, e.Auth.Id) {
		factors = append(factors, factorSummary(factor))
	}
	return e.JSON(http.StatusOK, map[string]any{"factors": factors, "recoveryCodesLeft": len(recoveryCodeHashes(e.App, e.Auth.Id))})
}

func deleteMFAFactor(e *core.RequestEvent) error {
	if err := requirePassword(e); err != nil {
		return err
	}
	factor, err := e.App.FindRecordById("mfa_factors", e.Request.PathValue("id"))
	if err != nil || factor.GetString("user") != e.Auth.Id {
		return e.NotFoundError("", nil)
	}
	if err := e.App.Delete(factor); err != nil {
		return e.InternalServerError("", err)
	}
	if len(mfaFactors(e.App, e.Auth.Id)) == 0 {
		deleteRecoveryCodes(e.App, e.Auth.Id)
	}
	action := "mfa_disabled"
	if factor.GetString("kind") == mfaMethodPasskey {
		action = "passkey_removed"
	}
	writeAuthEvent(e, nil, e.Auth, action, "")
	return e.NoContent(http.StatusNoContent)
}

func renameMFAFactor(e *core.RequestEvent) error {
	var body struct {
		Name string `json:"name"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	factor, err := e.App.FindRecordById("mfa_factors", e.Request.PathValue("id"))
	if err != nil || factor.GetString("user") != e.Auth.Id {
		return e.NotFoundError("", nil)
	}
	factor.Set("name", truncateRunes(strings.TrimSpace(body.Name), 60))
	if err := e.App.Save(factor); err != nil {
		return e.BadRequestError("", err)
	}
	return e.JSON(http.StatusOK, factorSummary(factor))
}

func requirePassword(e *core.RequestEvent) error {
	var body struct {
		Password string `json:"password"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	if isLockedOut(e.App, e.Auth.Id) {
		return errAccountLocked()
	}
	if !e.Auth.ValidatePassword(body.Password) {
		recordLoginFailure(e, e.Auth.Id, e.Auth)
		return apis.NewBadRequestError("Invalid password.", map[string]any{"password": map[string]string{"code": "invalid_password", "message": "Invalid password."}})
	}
	return nil
}

func totpSetup(e *core.RequestEvent) error {
	if err := requirePassword(e); err != nil {
		return err
	}
	secret := newTOTPSecret()
	account := firstNonEmpty(e.Auth.Email(), e.Auth.GetString("username"))
	return e.JSON(http.StatusOK, map[string]string{"secret": secret, "uri": totpURI(e.App.Settings().Meta.AppName, account, secret)})
}

func totpEnable(e *core.RequestEvent) error {
	if err := requirePassword(e); err != nil {
		return err
	}
	var body struct {
		Secret string `json:"secret"`
		Code   string `json:"code"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	key, err := decodeTOTPSecret(body.Secret)
	if err != nil {
		return e.BadRequestError("Invalid secret.", err)
	}
	step := matchTOTP(key, body.Code, time.Now(), 0)
	if step == 0 {
		return apis.NewBadRequestError("Invalid code.", map[string]any{"code": map[string]string{"code": "invalid_code", "message": "Invalid code."}})
	}
	for _, factor := range mfaFactors(e.App, e.Auth.Id) {
		if factor.GetString("kind") == mfaMethodTOTP {
			return e.BadRequestError("An authenticator app is already set up.", nil)
		}
	}
	factor, err := newFactor(e.App, e.Auth.Id, mfaMethodTOTP)
	if err != nil {
		return e.InternalServerError("", err)
	}
	factor.Set("secret", totpEncoding.EncodeToString(key))
	factor.Set("algorithm", totpAlgorithm)
	factor.Set("digits", totpDigits)
	factor.Set("period", totpPeriod)
	factor.Set("last_step", step)
	return saveFactor(e, factor, "mfa_enabled")
}

func newFactor(app core.App, userID, kind string) (*core.Record, error) {
	collection, err := app.FindCachedCollectionByNameOrId("mfa_factors")
	if err != nil {
		return nil, err
	}
	factor := core.NewRecord(collection)
	factor.Set("user", userID)
	factor.Set("kind", kind)
	return factor, nil
}

func saveFactor(e *core.RequestEvent, factor *core.Record, action string) error {
	first := len(mfaFactors(e.App, e.Auth.Id)) == 0
	if err := e.App.Save(factor); err != nil {
		return e.BadRequestError("", err)
	}
	writeAuthEvent(e, nil, e.Auth, action, "")
	result := map[string]any{"factor": factorSummary(factor)}
	if first || len(recoveryCodeHashes(e.App, e.Auth.Id)) == 0 {
		codes, err := issueRecoveryCodes(e.App, e.Auth.Id)
		if err != nil {
			return e.InternalServerError("", err)
		}
		result["recoveryCodes"] = codes
	}
	return e.JSON(http.StatusOK, result)
}

func mfaUser(e *core.RequestEvent, mfaID string) (*core.Record, error) {
	mfa, err := e.App.FindMFAById(mfaID)
	if err != nil {
		return nil, e.BadRequestError("Invalid or expired MFA session.", err)
	}
	user, err := e.App.FindRecordById(mfa.CollectionRef(), mfa.RecordRef())
	if err != nil || user.Collection().Name != "users" || mfa.HasExpired(mfaSessionTTL) {
		return nil, e.BadRequestError("Invalid or expired MFA session.", err)
	}
	if isLockedOut(e.App, user.Id) {
		return nil, errAccountLocked()
	}
	return user, nil
}

func authWithTOTP(e *core.RequestEvent) error {
	var body struct {
		MFAID string `json:"mfaId"`
		Code  string `json:"code"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	user, err := mfaUser(e, body.MFAID)
	if err != nil {
		return err
	}
	var factor *core.Record
	for _, candidate := range mfaFactors(e.App, user.Id) {
		if candidate.GetString("kind") == mfaMethodTOTP {
			factor = candidate
		}
	}
	step := int64(0)
	if factor != nil {
		if key, err := decodeTOTPSecret(factor.GetString("secret")); err == nil {
			step = matchTOTP(key, body.Code, time.Now(), int64(factor.GetInt("last_step")))
		}
	}
	if err := guardLockout(e, user, step != 0 && claimTOTPStep(e.App, factor.Id, step)); err != nil {
		return err
	}
	return apis.RecordAuthResponse(e, user, mfaMethodTOTP, nil)
}

func claimTOTPStep(app core.App, factorID string, step int64) bool {
	err := app.RunInTransaction(func(txApp core.App) error {
		factor, err := txApp.FindRecordById("mfa_factors", factorID)
		if err != nil {
			return err
		}
		if int64(factor.GetInt("last_step")) >= step {
			return errFactorRejected
		}
		factor.Set("last_step", step)
		factor.Set("last_used", time.Now())
		return txApp.Save(factor)
	})
	return err == nil
}

func authWithRecoveryCode(e *core.RequestEvent) error {
	var body struct {
		MFAID string `json:"mfaId"`
		Code  string `json:"code"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	user, err := mfaUser(e, body.MFAID)
	if err != nil {
		return err
	}
	hash := hashRecoveryCode(body.Code)
	if err := guardLockout(e, user, updateRecoveryCodes(e.App, user.Id, func(hashes []string) ([]string, bool) {
		index := slices.IndexFunc(hashes, func(stored string) bool {
			return subtle.ConstantTimeCompare([]byte(stored), []byte(hash)) == 1
		})
		if index < 0 {
			return nil, false
		}
		return slices.Delete(hashes, index, index+1), true
	})); err != nil {
		return err
	}
	if err := apis.RecordAuthResponse(e, user, mfaMethodRecovery, nil); err != nil {
		updateRecoveryCodes(e.App, user.Id, func(hashes []string) ([]string, bool) { return append(hashes, hash), true })
		return err
	}
	writeAuthEvent(e, nil, user, "recovery_code_used", "")
	return nil
}

func updateRecoveryCodes(app core.App, userID string, change func([]string) ([]string, bool)) bool {
	err := app.RunInTransaction(func(txApp core.App) error {
		record, err := txApp.FindFirstRecordByData("mfa_recovery_codes", "user", userID)
		if err != nil {
			return err
		}
		hashes := []string{}
		_ = record.UnmarshalJSONField("codes", &hashes)
		changed, ok := change(hashes)
		if !ok {
			return errFactorRejected
		}
		record.Set("codes", changed)
		return txApp.Save(record)
	})
	return err == nil
}

func regenerateRecoveryCodes(e *core.RequestEvent) error {
	if err := requirePassword(e); err != nil {
		return err
	}
	if len(mfaFactors(e.App, e.Auth.Id)) == 0 {
		return e.BadRequestError("Two-factor authentication is not set up.", nil)
	}
	codes, err := issueRecoveryCodes(e.App, e.Auth.Id)
	if err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"recoveryCodes": codes})
}

func recoveryCodeHashes(app core.App, userID string) []string {
	record, err := app.FindFirstRecordByData("mfa_recovery_codes", "user", userID)
	if err != nil {
		return nil
	}
	hashes := []string{}
	_ = record.UnmarshalJSONField("codes", &hashes)
	return hashes
}

func issueRecoveryCodes(app core.App, userID string) ([]string, error) {
	record, err := app.FindFirstRecordByData("mfa_recovery_codes", "user", userID)
	if err != nil {
		collection, err := app.FindCachedCollectionByNameOrId("mfa_recovery_codes")
		if err != nil {
			return nil, err
		}
		record = core.NewRecord(collection)
		record.Set("user", userID)
	}
	codes := make([]string, recoveryCodeCount)
	hashes := make([]string, recoveryCodeCount)
	for i := range codes {
		raw := make([]byte, 10)
		_, _ = rand.Read(raw)
		code := strings.ToLower(totpEncoding.EncodeToString(raw))
		codes[i] = code[:4] + "-" + code[4:8] + "-" + code[8:12] + "-" + code[12:]
		hashes[i] = hashRecoveryCode(codes[i])
	}
	record.Set("codes", hashes)
	return codes, app.Save(record)
}

func hashRecoveryCode(code string) string {
	normalized := strings.ToLower(strings.NewReplacer("-", "", " ", "").Replace(code))
	digest := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(digest[:])
}

func deleteRecoveryCodes(app core.App, userID string) {
	if _, err := app.DB().NewQuery("DELETE FROM mfa_recovery_codes WHERE user = {:user}").Bind(dbx.Params{"user": userID}).Execute(); err != nil {
		app.Logger().Error("mfa: failed to delete recovery codes", "error", err)
	}
}
