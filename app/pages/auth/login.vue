<template>
    <LayoutAuthLayout
        :loading="loading"
        :eyebrow="viewEyebrow"
        :title="viewTitle"
        :subtitle="viewSubtitle"
        :heading-key="view"
    >
        <template #brand-headline>
            {{ $t('account.brandHeadline.login.l1') }}<br />
            {{ $t('account.brandHeadline.login.l2') }}<br />
            <span class="text-success">{{
                $t('account.brandHeadline.login.accent')
            }}</span>
        </template>

        <div v-if="!hasAnyAuth" class="text-center py-10">
            <UIcon
                name="i-lucide-circle-alert"
                class="mb-3 size-[48px] text-warning"
            />
            <p class="text-sm text-muted">
                {{ $t('notifications.error.no_auth_methods_available') }}
            </p>
        </div>

        <div v-else class="relative">
            <Transition name="form-swap" mode="out-in">
                <UForm
                    v-if="view === 'login'"
                    key="login"
                    ref="loginForm"
                    :state="loginState"
                    :validate="validateLogin"
                    :validate-on="[]"
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
                            :autocomplete="identityAutocomplete"
                            :name="identityAutocomplete"
                            :disabled="loading"
                            color="success"
                            class="w-full"
                            data-testid="login-identity"
                            autofocus
                            @keydown.enter.prevent="submitLogin"
                        >
                            <template v-if="identity" #trailing>
                                <UButton
                                    icon="i-lucide-x"
                                    color="neutral"
                                    variant="link"
                                    size="sm"
                                    :aria-label="$t('actions.clear')"
                                    @click="identity = ''"
                                />
                            </template>
                        </UInput>
                    </UFormField>

                    <UserPasswordField
                        v-if="authMethods.password?.enabled"
                        v-model="password"
                        :label="$t('account.password')"
                        icon="i-lucide-lock"
                        name="password"
                        data-testid="login-password"
                        :disabled="loading"
                        color="success"
                        class="mb-4"
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
                                size="sm"
                                class="px-0 mt-1 block"
                                data-testid="login-resend-verification"
                                @click="openResendVerification"
                            >
                                {{ $t('account.resendVerification') }}
                            </UButton>
                        </template>
                    </UAlert>

                    <div class="flex items-center justify-between mb-5">
                        <UCheckbox
                            v-model="rememberMe"
                            :label="$t('account.remember_me')"
                            color="success"
                            data-testid="login-remember-me"
                        />
                        <UButton
                            variant="ghost"
                            color="primary"
                            size="sm"
                            data-testid="login-goto-reset"
                            @click="view = 'requestReset'"
                        >
                            {{ $t('account.reset_password') }}
                        </UButton>
                    </div>

                    <UButton
                        type="submit"
                        color="primary"
                        block
                        size="lg"
                        :disabled="loading"
                        class="mb-3 font-semibold"
                        data-testid="login-submit"
                    >
                        <CaptchaLoader v-if="loading" />
                        <template v-else>{{ $t('account.login') }}</template>
                    </UButton>

                    <UButton
                        v-if="canRegister"
                        color="neutral"
                        variant="soft"
                        block
                        class="mb-3"
                        :disabled="loading"
                        data-testid="login-goto-register"
                        @click="view = 'register'"
                    >
                        {{ $t('account.createAccount') }}
                    </UButton>

                    <UButton
                        color="neutral"
                        variant="ghost"
                        block
                        class="text-muted mb-1"
                        icon="i-lucide-arrow-left"
                        :disabled="loading"
                        @click="navigateTo('/')"
                    >
                        {{ $t('actions.back_to_home') }}
                    </UButton>

                    <template v-if="authMethods.oauth2?.enabled">
                        <div class="flex items-center gap-3 my-4">
                            <USeparator class="flex-1" />
                            <span class="text-xs text-muted whitespace-nowrap">
                                {{ $t('account.or_login_with') }}
                            </span>
                            <USeparator class="flex-1" />
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <UButton
                                v-for="p in authMethods.oauth2.providers"
                                :key="p.name"
                                :disabled="loading"
                                color="neutral"
                                variant="outline"
                                block
                                :icon="providerIcon(p.name)"
                                @click="loginWithOAuth(p.name)"
                            >
                                {{ p.displayName }}
                            </UButton>
                        </div>
                    </template>
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
                            :disabled="loading"
                            color="success"
                            class="w-full"
                            data-testid="register-username"
                            autofocus
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
                            :disabled="loading"
                            color="success"
                            class="w-full"
                            data-testid="register-email"
                        />
                    </UFormField>
                    <UserPasswordChangeFields
                        v-model:password="registerPassword"
                        v-model:password-confirm="registerPasswordConfirm"
                        :require-old-password="false"
                        @validity="registerPasswordValid = $event"
                    />

                    <UButton
                        type="submit"
                        color="primary"
                        block
                        size="lg"
                        :disabled="loading"
                        class="mt-6 mb-3 font-semibold"
                        data-testid="register-submit"
                    >
                        <CaptchaLoader v-if="loading" />
                        <template v-else>{{
                            $t('account.createAccount')
                        }}</template>
                    </UButton>

                    <UButton
                        color="neutral"
                        variant="ghost"
                        block
                        :disabled="loading"
                        class="text-muted"
                        @click="view = 'login'"
                    >
                        {{ $t('actions.cancel') }}
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
                    <UAlert
                        color="success"
                        variant="soft"
                        icon="i-lucide-mail"
                        class="mb-6"
                        :description="
                            view === 'requestReset'
                                ? $t('account.resetInfo')
                                : $t('account.resendVerificationInfo')
                        "
                    />

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
                            :disabled="loading"
                            color="success"
                            class="w-full"
                            data-testid="reset-email"
                            autofocus
                        >
                            <template v-if="resetEmail" #trailing>
                                <UButton
                                    icon="i-lucide-x"
                                    color="neutral"
                                    variant="link"
                                    size="sm"
                                    :aria-label="$t('actions.clear')"
                                    @click="resetEmail = ''"
                                />
                            </template>
                        </UInput>
                    </UFormField>

                    <UButton
                        type="submit"
                        color="primary"
                        block
                        size="lg"
                        :disabled="loading"
                        class="mb-3 font-semibold"
                        data-testid="reset-submit"
                    >
                        <CaptchaLoader v-if="loading" />
                        <template v-else>{{ $t('actions.submit') }}</template>
                    </UButton>

                    <UButton
                        color="neutral"
                        variant="ghost"
                        block
                        :disabled="loading"
                        class="text-muted"
                        @click="view = 'login'"
                    >
                        {{ $t('actions.cancel') }}
                    </UButton>
                </UForm>
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
} from '~/utils/validation'
import type { Rule } from '~/utils/validation'
import { safeRedirect, staffLandingPath } from '~/utils/nav'
defineOptions({ name: 'LoginPage' })

const { t, locale } = useI18n()
const pb = usePocketbase()
const { capHeaders } = useCapToken()
const route = useRoute()
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

if (pb.authStore.isValid) {
    try {
        await pb.collection('users').authRefresh()
        await navigateTo(await afterLoginPath(), { replace: true })
    } catch {
        pb.authStore.clear()
    }
}

const authMethods = await pb.collection('users').listAuthMethods()
const hasAnyAuth = !!(
    authMethods?.password?.enabled || authMethods?.oauth2?.enabled
)

const { allowRegistration } = useOrgSettings()
const canRegister = computed(
    () => allowRegistration.value && !!authMethods?.password?.enabled,
)

// ── State ──────────────────────────────────────────────────────────
const { notify, error: notifyError } = useNotification()
const view = ref(route.query.view === 'register' ? 'register' : 'login')
const loading = ref(false)
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

type AnyForm = Form<Record<string, unknown>>
const loginForm = useTemplateRef<AnyForm>('loginForm')
const resetForm = useTemplateRef<AnyForm>('resetForm')
const registerForm = useTemplateRef<AnyForm>('registerForm')

// ── Identity config ────────────────────────────────────────────────
const idFields = authMethods?.password?.identityFields ?? []
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
        })[view.value] ?? '',
)
const viewTitle = computed(
    () =>
        ({
            login: t('account.login'),
            requestReset: t('account.reset_password'),
            register: t('account.createAccount'),
            resendVerification: t('account.resendVerification'),
        })[view.value] ?? '',
)
const viewSubtitle = computed(
    () =>
        ({
            login: t('account.login_hint'),
            requestReset: t('account.reset_hint'),
            register: t('account.register_hint'),
            resendVerification: t('account.reset_hint'),
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
const usernameRules: Rule[] = [
    required(t),
    minLength(t, 3),
    (value) =>
        /^[\w][\w.-]*$/.test(String(value ?? '')) ||
        t('account.usernameInvalid'),
]

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
        ...(authMethods.password?.enabled && { password: passwordRules }),
    })
const validateRegister = (state: Record<string, unknown>) =>
    validateRules(state, { username: usernameRules, email: emailRules })
const validateReset = (state: Record<string, unknown>) =>
    validateRules(state, { email: emailRules })

// ── OAuth icons ────────────────────────────────────────────────────
const PROVIDER_ICONS: Record<string, string> = {
    apple: 'i-simple-icons-apple',
    google: 'i-simple-icons-google',
    microsoft: 'i-simple-icons-microsoft',
    facebook: 'i-simple-icons-facebook',
    github: 'i-simple-icons-github',
    gitlab: 'i-simple-icons-gitlab',
    discord: 'i-simple-icons-discord',
    twitter: 'i-simple-icons-x',
    spotify: 'i-simple-icons-spotify',
    twitch: 'i-simple-icons-twitch',
    bitbucket: 'i-simple-icons-bitbucket',
    oidc: 'i-lucide-lock',
    oidc2: 'i-lucide-lock',
    oidc3: 'i-lucide-lock',
}
const providerIcon = (name: string) => PROVIDER_ICONS[name] ?? 'i-lucide-log-in'

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
    await nextTick()
    document.querySelector('input')?.focus()
}

watch(view, focusFirstInput)
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

function isUnverifiedError(err: unknown) {
    return (
        (err as { status?: number })?.status === 403 ||
        /not verified/i.test(authErrorMessage(err))
    )
}

function resolveAuthError(err: unknown) {
    const msg = authErrorMessage(err)
    if (/invalid.+credentials/i.test(msg))
        return t('notifications.error.invalid_credentials')
    if (isUnverifiedError(err))
        return t('notifications.error.email_not_verified')
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
        await pb
            .collection('users')
            .authWithPassword(identity.value, password.value, {
                headers: await capHeaders('login'),
            })
        await navigateTo(await afterLoginPath(), { replace: true })
    } catch (err) {
        unverified.value = isUnverifiedError(err)
        notifyError(resolveAuthError(err))
    } finally {
        loading.value = false
    }
}

function openResendVerification() {
    resetEmail.value = identity.value.includes('@') ? identity.value : ''
    view.value = 'resendVerification'
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
        await pb.collection('users').requestVerification(resetEmail.value)
        notify(t('notifications.success.verificationSent'))
        unverified.value = false
        view.value = 'login'
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
        await pb.collection('users').requestPasswordReset(resetEmail.value, {
            headers: await capHeaders('password-reset'),
        })
        notify(t('notifications.success.resetPassword'))
        view.value = 'login'
        resetEmail.value = ''
    } catch (err) {
        notifyError(resolveAuthError(err))
    } finally {
        loading.value = false
    }
}

function resolveRegisterError(err: unknown) {
    const fields = (
        err as { data?: { data?: Record<string, { code?: string }> } }
    )?.data?.data
    if (fields?.username?.code === 'validation_not_unique')
        return t('users.usernameTaken')
    if (fields?.email) return t('account.emailTaken')
    return resolveAuthError(err)
}

async function submitRegister() {
    if (!(await validate(registerForm)) || !registerPasswordValid.value) return
    loading.value = true
    try {
        await pb.collection('users').create(
            {
                username: registerUsername.value,
                email: registerEmail.value,
                password: registerPassword.value,
                passwordConfirm: registerPasswordConfirm.value,
                language: locale.value,
            },
            { headers: await capHeaders('register') },
        )
        const verificationSent = await pb
            .collection('users')
            .requestVerification(registerEmail.value)
            .then(
                () => true,
                () => false,
            )
        if (verificationSent) notify(t('notifications.success.registered'))
        else notifyError(t('notifications.error.verificationMail'))
        identity.value = registerUsername.value
        registerPassword.value = registerPasswordConfirm.value = ''
        view.value = 'login'
    } catch (err) {
        notifyError(resolveRegisterError(err))
    } finally {
        loading.value = false
    }
}

async function loginWithOAuth(provider: string) {
    loading.value = true
    setAuthPersistent(rememberMe.value)
    try {
        await pb.collection('users').authWithOAuth2({ provider })
        await navigateTo(await afterLoginPath(), { replace: true })
    } catch (err) {
        notifyError(resolveAuthError(err))
    } finally {
        loading.value = false
    }
}
</script>
