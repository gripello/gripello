<template>
    <LayoutAuthLayout
        :loading="loading"
        :eyebrow="viewEyebrow"
        :title="viewTitle"
        :subtitle="viewSubtitle"
        :heading-key="view"
        :back-to="backTo"
    >
        <template #brand-headline>
            {{ $t('account.brandHeadline.login.l1') }}<br />
            {{ $t('account.brandHeadline.login.l2') }}<br />
            <span class="text-success">{{
                $t('account.brandHeadline.login.accent')
            }}</span>
        </template>

        <div class="relative">
            <Transition name="form-swap" mode="out-in">
                <UForm
                    v-if="view === 'login'"
                    key="login"
                    ref="loginForm"
                    :state="loginState"
                    :validate="validateLogin"
                    :validate-on="[]"
                    :loading-auto="false"
                    data-testid="login-form"
                    @submit="submitLogin"
                >
                    <UFormField
                        :label="identityLabel"
                        name="identity"
                        class="mb-4"
                    >
                        <UInput
                            v-model="identity"
                            :icon="identityIcon"
                            :type="identityInputType"
                            :autocomplete="
                                passkey.autofillActive.value
                                    ? `${identityAutocomplete} webauthn`
                                    : identityAutocomplete
                            "
                            :name="identityAutocomplete"
                            :disabled="loading"
                            size="xl"
                            color="success"
                            class="w-full"
                            autocapitalize="none"
                            autocorrect="off"
                            spellcheck="false"
                            enterkeyhint="next"
                            data-testid="login-identity"
                            @keydown.enter.prevent="nextFromIdentity"
                        />
                    </UFormField>

                    <UserPasswordField
                        v-model="password"
                        :label="$t('account.password')"
                        icon="i-lucide-lock"
                        name="password"
                        data-testid="login-password"
                        :disabled="loading"
                        size="xl"
                        color="success"
                        enterkeyhint="go"
                        class="mb-2"
                        @keydown="detectCapsLock"
                        @keydown.enter.prevent="submitLogin"
                    />

                    <UAlert
                        v-if="capsLockOn"
                        color="warning"
                        variant="soft"
                        icon="i-lucide-triangle-alert"
                        class="mb-3"
                        :description="$t('account.capsLockOn')"
                    />

                    <UAlert
                        v-if="unverified"
                        color="warning"
                        variant="soft"
                        icon="i-lucide-triangle-alert"
                        class="mb-3"
                        data-testid="login-unverified"
                    >
                        <template #description>
                            {{ $t('notifications.error.email_not_verified') }}
                            <UButton
                                color="warning"
                                variant="link"
                                class="px-0 mt-1 block"
                                data-testid="login-resend-verification"
                                @click="openResendVerification"
                            >
                                {{ $t('account.resendVerification') }}
                            </UButton>
                        </template>
                    </UAlert>

                    <div class="flex items-center justify-between mb-4">
                        <UCheckbox
                            v-model="rememberMe"
                            :label="$t('account.remember_me')"
                            color="success"
                            class="min-h-11 items-center"
                            data-testid="login-remember-me"
                        />
                        <UButton
                            variant="link"
                            color="primary"
                            class="min-h-11 px-0"
                            data-testid="login-goto-reset"
                            @click="openView('requestReset')"
                        >
                            {{ $t('account.reset_password') }}
                        </UButton>
                    </div>

                    <UButton
                        type="submit"
                        color="primary"
                        block
                        size="xl"
                        :disabled="loading"
                        class="mb-3 font-semibold"
                        data-testid="login-submit"
                    >
                        <CaptchaLoader v-if="loading" />
                        <template v-else>{{ $t('account.login') }}</template>
                    </UButton>

                    <USeparator
                        v-if="passkey.supported.value || oauth2Providers.length"
                        :label="$t('auth.or')"
                        :ui="{ label: 'text-xs text-muted' }"
                        class="my-4"
                    />

                    <UButton
                        v-if="passkey.supported.value"
                        color="neutral"
                        variant="outline"
                        block
                        size="xl"
                        icon="i-lucide-key-round"
                        class="mb-3"
                        :disabled="loading"
                        data-testid="login-passkey"
                        @click="loginWithPasskey"
                    >
                        {{ $t('account.twoFactor.signInWithPasskey') }}
                    </UButton>

                    <UButton
                        v-for="provider in oauth2Providers"
                        :key="provider.name"
                        color="neutral"
                        variant="outline"
                        block
                        size="xl"
                        :icon="oauth2ProviderIcon(provider.name)"
                        class="mb-3"
                        :disabled="loading"
                        :data-testid="`login-oauth2-${provider.name}`"
                        @click="loginWithOAuth2(provider.name)"
                    >
                        {{
                            $t('auth.oauth2.continueWith', {
                                provider: oauth2ProviderName(provider),
                            })
                        }}
                    </UButton>

                    <p
                        v-if="canRegister"
                        class="mt-4 flex items-center justify-center gap-1 text-sm text-muted"
                    >
                        {{ $t('account.noAccount') }}
                        <UButton
                            variant="link"
                            color="primary"
                            class="min-h-11 px-1 font-semibold"
                            :disabled="loading"
                            data-testid="login-goto-register"
                            @click="openView('register')"
                        >
                            {{ $t('account.createAccount') }}
                        </UButton>
                    </p>
                </UForm>

                <UForm
                    v-else-if="view === 'register'"
                    key="register"
                    ref="registerForm"
                    :state="registerState"
                    :validate="validateRegister"
                    :validate-on="[]"
                    data-testid="register-form"
                    @submit="submitRegister"
                >
                    <UFormField
                        :label="$t('account.username')"
                        name="username"
                        class="mb-4"
                    >
                        <UInput
                            v-model="registerUsername"
                            icon="i-lucide-user"
                            autocomplete="username"
                            autocapitalize="none"
                            autocorrect="off"
                            spellcheck="false"
                            enterkeyhint="next"
                            :disabled="loading"
                            size="xl"
                            color="success"
                            class="w-full"
                            data-testid="register-username"
                        />
                    </UFormField>
                    <UFormField
                        :label="$t('account.email')"
                        name="email"
                        class="mb-4"
                    >
                        <UInput
                            v-model="registerEmail"
                            icon="i-lucide-mail"
                            type="email"
                            autocomplete="email"
                            enterkeyhint="next"
                            :disabled="loading"
                            size="xl"
                            color="success"
                            class="w-full"
                            data-testid="register-email"
                        />
                    </UFormField>
                    <UserPasswordChangeFields
                        v-model:password="registerPassword"
                        v-model:password-confirm="registerPasswordConfirm"
                        :require-old-password="false"
                        size="xl"
                        @validity="registerPasswordValid = $event"
                    />

                    <UButton
                        type="submit"
                        color="primary"
                        block
                        size="xl"
                        :disabled="loading"
                        class="mt-6 font-semibold"
                        data-testid="register-submit"
                    >
                        <CaptchaLoader v-if="loading" />
                        <template v-else>{{
                            $t('account.createAccount')
                        }}</template>
                    </UButton>
                </UForm>

                <UForm
                    v-else-if="isEmailRequestView"
                    :key="view"
                    ref="resetForm"
                    :state="resetState"
                    :validate="validateReset"
                    :validate-on="[]"
                    data-testid="reset-form"
                    @submit="submitEmailRequest"
                >
                    <UFormField
                        :label="$t('account.email')"
                        name="email"
                        class="mb-5"
                    >
                        <UInput
                            v-model="resetEmail"
                            icon="i-lucide-mail"
                            type="email"
                            autocomplete="email"
                            enterkeyhint="send"
                            :disabled="loading"
                            size="xl"
                            color="success"
                            class="w-full"
                            data-testid="reset-email"
                        />
                    </UFormField>

                    <UButton
                        type="submit"
                        color="primary"
                        block
                        size="xl"
                        :disabled="loading"
                        class="font-semibold"
                        data-testid="reset-submit"
                    >
                        <CaptchaLoader v-if="loading" />
                        <template v-else>{{ $t('actions.submit') }}</template>
                    </UButton>
                </UForm>

                <AuthTwoFactorStep
                    v-else-if="view === 'twoFactor'"
                    key="twoFactor"
                    v-model:method="secondFactorMethod"
                    :mfa-id="mfaId"
                    :methods="secondFactorMethods"
                    @authenticated="finishLogin"
                    @failed="abandonSecondFactor"
                    @back="leaveSecondFactor"
                />
            </Transition>
        </div>
    </LayoutAuthLayout>
</template>

<script setup lang="ts">
import type { Ref } from 'vue'
import type { Form } from '@nuxt/ui'
import {
    required,
    validEmail,
    minLength,
    validateRules,
    validUsername,
} from '~/utils/validation'
import { safeRedirect, staffLandingPath } from '~/utils/nav'
import { isPasskeyCancel } from '~/utils/webauthn'
import { isInvalidCredentials } from '~/utils/authErrors'
import { blockedFieldError } from '~/utils/fieldErrors'
import { authView, authViewQuery, type AuthView } from '~/utils/authView'
import {
    oauth2ErrorKey,
    oauth2ProviderIcon,
    oauth2ProviderName,
} from '~/utils/oauth2'
import { openSignInPage } from '~/utils/native'
import {
    finishOAuth2,
    listOAuth2Providers,
    login,
    mfaRequired,
    startOAuth2,
    refreshAuth,
    register,
    requestPasswordReset,
    requestVerification,
    useAuthState,
    type AuthResult,
    type SecondFactorMethod,
} from '~/api/auth'
defineOptions({ name: 'LoginPage' })

const { t, locale } = useI18n()
const auth = useAuthState()
const { capHeaders } = useCapToken()
const route = useRoute()
const router = useRouter()
const requestedRedirect = safeRedirect(route.query.redirect)
const { memberships, ensureLoaded } = usePermissions()

async function afterLoginPath() {
    if (requestedRedirect) return requestedRedirect
    await ensureLoaded()
    return staffLandingPath(memberships.value)
}

definePageMeta({ layout: 'blank', auth: false })

useHead({
    title: t('page.title.login'),
})

if (auth.isSignedIn()) {
    try {
        await refreshAuth()
        await navigateTo(await afterLoginPath(), { replace: true })
    } catch {
        auth.clearAuth()
    }
}

const { allowRegistration } = useOrgSettings()
const canRegister = allowRegistration

// ── State ──────────────────────────────────────────────────────────
const { notify, error: notifyError } = useNotification()
const twoFactorOpen = ref(false)
const view = computed(() =>
    twoFactorOpen.value ? 'twoFactor' : authView(route.query.view),
)
const loginUrl = computed(
    () => router.resolve({ query: authViewQuery(route.query) }).fullPath,
)
const backTo = computed(() =>
    view.value === 'twoFactor'
        ? ''
        : view.value === 'login'
          ? '/'
          : loginUrl.value,
)

function openView(next: AuthView) {
    void router.push({ query: authViewQuery(route.query, next) })
}

function returnToLogin() {
    if (window.history.state?.back === loginUrl.value) return router.back()
    void router.replace(loginUrl.value)
}
const oauth2Ticket = route.query.oauth2
const loading = ref(typeof oauth2Ticket === 'string' && !!oauth2Ticket)
const identity = ref('')
const password = ref('')
const resetEmail = ref('')
const registerUsername = ref('')
const registerEmail = ref('')
const registerPassword = ref('')
const registerPasswordConfirm = ref('')
const rememberMe = ref(true)
const capsLockOn = ref(false)
const unverified = ref(false)
const registerPasswordValid = ref(false)
const mfaId = ref('')
const secondFactorMethods = ref<SecondFactorMethod[]>([])
const secondFactorMethod = ref<SecondFactorMethod>('totp')
const passkey = usePasskeyLogin()
onMounted(() => {
    if (!loading.value) offerPasskeyAutofill()
})

type AnyForm = Form<Record<string, unknown>>
const loginForm = useTemplateRef<AnyForm>('loginForm')
const resetForm = useTemplateRef<AnyForm>('resetForm')
const registerForm = useTemplateRef<AnyForm>('registerForm')

// ── Identity config ────────────────────────────────────────────────
const idFields = ['email', 'username']
const supportsEmail = idFields.includes('email')
const supportsUser = idFields.includes('username')

const identityLabel = computed(() =>
    supportsEmail && supportsUser
        ? t('account.username_or_email')
        : supportsEmail
          ? t('account.email')
          : t('account.username'),
)
const identityInputType = computed(() =>
    supportsEmail && !supportsUser ? 'email' : 'text',
)
const identityAutocomplete = computed(() =>
    supportsEmail ? 'email' : 'username',
)
const identityIcon = computed(() =>
    supportsEmail && !supportsUser ? 'i-lucide-mail' : 'i-lucide-user',
)

// ── View meta ──────────────────────────────────────────────────────
const viewEyebrow = computed(
    () =>
        ({
            login: t('account.eyebrowWelcomeBack'),
            requestReset: t('account.eyebrowAccountRecovery'),
            register: t('account.eyebrowRegister'),
            resendVerification: t('account.eyebrowVerifyEmail'),
            twoFactor: t('account.eyebrowWelcomeBack'),
        })[view.value] ?? '',
)
const viewTitle = computed(
    () =>
        ({
            login: t('account.login'),
            requestReset: t('account.reset_password'),
            register: t('account.createAccount'),
            resendVerification: t('account.resendVerification'),
            twoFactor: {
                totp: t('account.twoFactor.titleCode'),
                passkey: t('account.twoFactor.titlePasskey'),
                recovery: t('account.twoFactor.titleRecovery'),
            }[secondFactorMethod.value],
        })[view.value] ?? '',
)
const viewSubtitle = computed(
    () =>
        ({
            login: '',
            requestReset: t('account.reset_hint'),
            register: t('account.register_hint'),
            resendVerification: t('account.reset_hint'),
            twoFactor: identity.value,
        })[view.value] ?? '',
)

// ── Validation ─────────────────────────────────────────────────────
const identityRules = computed(() => {
    const r = [required(t)]
    if (supportsEmail && !supportsUser) r.push(validEmail(t))
    return r
})
const passwordRules = [required(t), minLength(t, 6)]
const emailRules = [required(t), validEmail(t)]
const usernameRules = validUsername(t)

const loginState = computed(() => ({
    identity: identity.value,
    password: password.value,
}))
const registerState = computed(() => ({
    username: registerUsername.value,
    email: registerEmail.value,
}))
const resetState = computed(() => ({ email: resetEmail.value }))

const validateLogin = (state: Record<string, unknown>) =>
    validateRules(state, {
        identity: identityRules.value,
        password: passwordRules,
    })
const validateRegister = (state: Record<string, unknown>) =>
    validateRules(state, { username: usernameRules, email: emailRules })
const validateReset = (state: Record<string, unknown>) =>
    validateRules(state, { email: emailRules })

// ── Helpers ────────────────────────────────────────────────────────
async function validate(form: Readonly<Ref<AnyForm | null>>) {
    if (!form.value) return true
    return (await form.value.validate({ silent: true })) !== false
}

function detectCapsLock(ev: KeyboardEvent) {
    if (typeof ev.getModifierState === 'function')
        capsLockOn.value = ev.getModifierState('CapsLock')
}

async function focusFirstInput() {
    if (!window.matchMedia('(pointer: fine)').matches) return
    await nextTick()
    document.querySelector('input')?.focus()
}

function focusPassword() {
    document
        .querySelector<HTMLInputElement>('[data-testid="login-password"]')
        ?.focus()
}

function nextFromIdentity() {
    if (password.value) return submitLogin()
    focusPassword()
}

watch(view, focusFirstInput)
watch([identity, password], () => loginForm.value?.clear())
onMounted(focusFirstInput)
onNuxtReady(() =>
    preloadRouteComponents(requestedRedirect ?? '/gym/manage/routes'),
)

const isEmailRequestView = computed(() =>
    ['requestReset', 'resendVerification'].includes(view.value),
)

function authErrorMessage(err: unknown) {
    const { data, message } = (err ?? {}) as {
        data?: { message?: string }
        message?: string
    }
    return data?.message ?? message ?? ''
}

function isSuspendedError(err: unknown) {
    return /suspended/i.test(authErrorMessage(err))
}

function isUnverifiedError(err: unknown) {
    return (
        !isSuspendedError(err) &&
        ((err as { status?: number })?.status === 403 ||
            /not verified/i.test(authErrorMessage(err)))
    )
}

function isCredentialError(err: unknown) {
    const msg = authErrorMessage(err)
    return (
        isSuspendedError(err) ||
        isInvalidCredentials(msg) ||
        /locked|too many/i.test(msg)
    )
}

function resolveAuthError(err: unknown) {
    const msg = authErrorMessage(err)
    if (isSuspendedError(err)) return t('notifications.error.account_suspended')
    if (isInvalidCredentials(msg))
        return t('notifications.error.invalid_credentials')
    if (isUnverifiedError(err))
        return t('notifications.error.email_not_verified')
    if (/locked/i.test(msg)) return t('notifications.error.account_locked')
    if (/MFA session/i.test(msg)) return t('notifications.error.mfa_expired')
    if (/too many/i.test(msg)) return t('notifications.error.too_many_attempts')
    if (/captcha/i.test(msg)) return t('notifications.error.captcha')
    return t('notifications.error.unknown')
}

// ── Auth handlers ──────────────────────────────────────────────────
async function submitLogin() {
    if (!(await validate(loginForm))) return
    loading.value = true
    setAuthPersistent(rememberMe.value)
    try {
        await login(identity.value, password.value, await capHeaders('login'))
        await navigateTo(await afterLoginPath(), { replace: true })
    } catch (err) {
        const pendingMfa = mfaRequired(err)
        if (pendingMfa) {
            passkey.stopAutofill()
            mfaId.value = pendingMfa.mfaId
            secondFactorMethods.value = pendingMfa.methods
            secondFactorMethod.value = secondFactorMethods.value[0]!
            twoFactorOpen.value = true
            return
        }
        unverified.value = isUnverifiedError(err)
        if (unverified.value) return
        if (!isCredentialError(err)) return notifyError(resolveAuthError(err))
        loginForm.value?.setErrors([
            { name: 'password', message: resolveAuthError(err) },
        ])
        loading.value = false
        await nextTick()
        focusPassword()
    } finally {
        loading.value = false
    }
}

const { data: oauth2Providers } = useAsyncData(
    'oauth2-providers',
    listOAuth2Providers,
    { server: false, default: () => [] },
)

async function loginWithOAuth2(provider: string) {
    passkey.stopAutofill()
    loading.value = true
    setAuthPersistent(rememberMe.value)
    try {
        const { url } = await startOAuth2(provider, {
            redirect: requestedRedirect || undefined,
            persistent: rememberMe.value,
        })
        await openSignInPage(url)
        loading.value = false
    } catch {
        loading.value = false
        notifyError(t(oauth2ErrorKey('failed')))
    }
}

// The provider sent the browser back with a one-time ticket or an error code.
async function completeOAuth2() {
    const ticket = oauth2Ticket
    if (route.query.oauth2Error) {
        notifyError(t(oauth2ErrorKey(route.query.oauth2Error)))
        return
    }
    if (typeof ticket !== 'string' || !ticket) return
    loading.value = true
    rememberMe.value = route.query.persistent !== '0'
    setAuthPersistent(rememberMe.value)
    try {
        await finishOAuth2(ticket)
        await navigateTo(await afterLoginPath(), { replace: true })
    } catch (err) {
        loading.value = false
        const pendingMfa = mfaRequired(err)
        if (!pendingMfa) offerPasskeyAutofill()
        if (pendingMfa) {
            passkey.stopAutofill()
            mfaId.value = pendingMfa.mfaId
            secondFactorMethods.value = pendingMfa.methods
            secondFactorMethod.value = secondFactorMethods.value[0]!
            twoFactorOpen.value = true
            return
        }
        notifyError(resolveAuthError(err))
    }
}
onMounted(completeOAuth2)

async function finishLogin(result: AuthResult) {
    loading.value = true
    auth.saveAuth(result)
    await navigateTo(await afterLoginPath(), { replace: true })
}

function leaveSecondFactor() {
    mfaId.value = ''
    twoFactorOpen.value = false
    offerPasskeyAutofill()
}

function abandonSecondFactor(err: unknown) {
    notifyError(resolveAuthError(err))
    leaveSecondFactor()
}

function notifyPasskeyError(err: unknown) {
    if (isPasskeyCancel(err)) return
    notifyError(
        isSuspendedError(err)
            ? resolveAuthError(err)
            : t('account.twoFactor.passkeyFailed'),
    )
}

async function offerPasskeyAutofill() {
    setAuthPersistent(rememberMe.value)
    try {
        const result = await passkey.autofill()
        if (result) await finishLogin(result)
    } catch (err) {
        notifyPasskeyError(err)
        if ((err as { status?: number })?.status === 400) offerPasskeyAutofill()
    }
}

async function loginWithPasskey() {
    passkey.stopAutofill()
    loading.value = true
    setAuthPersistent(rememberMe.value)
    try {
        await finishLogin(await passkey.signIn())
    } catch (err) {
        loading.value = false
        notifyPasskeyError(err)
        offerPasskeyAutofill()
    }
}

function openResendVerification() {
    resetEmail.value = identity.value.includes('@') ? identity.value : ''
    openView('resendVerification')
}

function submitEmailRequest() {
    return view.value === 'requestReset'
        ? submitReset()
        : submitResendVerification()
}

async function submitResendVerification() {
    if (!(await validate(resetForm))) return
    loading.value = true
    try {
        await requestVerification(
            resetEmail.value,
            await capHeaders('verification'),
        )
        notify(t('notifications.success.verificationSent'))
        unverified.value = false
        returnToLogin()
        resetEmail.value = ''
    } catch (err) {
        notifyError(resolveAuthError(err))
    } finally {
        loading.value = false
    }
}

async function submitReset() {
    if (!(await validate(resetForm))) return
    loading.value = true
    try {
        await requestPasswordReset(
            resetEmail.value,
            await capHeaders('password-reset'),
        )
        notify(t('notifications.success.resetPassword'))
        returnToLogin()
        resetEmail.value = ''
    } catch (err) {
        notifyError(resolveAuthError(err))
    } finally {
        loading.value = false
    }
}

function registerFieldError(err: unknown) {
    const fields = (
        err as { data?: { data?: Record<string, { code?: string }> } }
    )?.data?.data
    if (fields?.username?.code === 'validation_not_unique')
        return { name: 'username', message: t('users.usernameTaken') }
    const blocked = blockedFieldError(err, ['email', 'username'])
    if (blocked) return { name: blocked.name, message: t(blocked.key) }
    if (fields?.email)
        return { name: 'email', message: t('account.emailTaken') }
    return null
}

async function submitRegister() {
    if (!(await validate(registerForm)) || !registerPasswordValid.value) return
    loading.value = true
    try {
        const { verificationSent } = await register(
            {
                username: registerUsername.value,
                email: registerEmail.value,
                password: registerPassword.value,
                passwordConfirm: registerPasswordConfirm.value,
                language: locale.value,
            },
            await capHeaders('register'),
        )
        if (verificationSent) notify(t('notifications.success.registered'))
        else notifyError(t('notifications.error.verificationMail'))
        identity.value = registerUsername.value
        registerPassword.value = registerPasswordConfirm.value = ''
        returnToLogin()
    } catch (err) {
        const fieldError = registerFieldError(err)
        if (fieldError) registerForm.value?.setErrors([fieldError])
        else notifyError(resolveAuthError(err))
    } finally {
        loading.value = false
    }
}
</script>
