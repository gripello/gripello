<template>
    <div class="pcf-root flex flex-col gap-4">
        <UserPasswordField
            v-if="requireOldPassword"
            :size="size"
            :model-value="oldPassword"
            :label="$t('account.oldPassword')"
            :placeholder="$t('account.placeholders.oldPassword')"
            :rules="[rules.required]"
            icon="i-lucide-lock-keyhole"
            data-testid="password-old"
            @update:model-value="emit('update:oldPassword', $event)"
        />

        <UserPasswordField
            :model-value="password"
            :size="size"
            :label="$t('account.password')"
            :placeholder="$t('account.placeholders.newPassword')"
            autocomplete="new-password"
            validate-on="blur"
            :rules="[rules.required, rules.minLength, rules.strength]"
            icon="i-lucide-lock-keyhole-open"
            data-testid="password-new"
            @update:model-value="emit('update:password', $event)"
        />

        <Transition name="pcf-slide-down">
            <div v-if="password" class="px-1">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs text-muted">
                        {{ $t('account.passwordStrength') }}
                    </span>
                    <span
                        class="text-xs font-bold"
                        :class="strengthClasses.text"
                    >
                        {{ $t(`account.strength.${strengthLabel}`) }}
                    </span>
                </div>

                <div class="pcf-strength-track">
                    <div
                        v-for="n in 4"
                        :key="n"
                        class="pcf-strength-segment"
                        :class="
                            n <= strengthScore
                                ? strengthClasses.bg
                                : 'pcf-segment-empty'
                        "
                    />
                </div>

                <div class="mt-3 pcf-requirements-grid">
                    <div
                        v-for="req in passwordRequirements"
                        :key="req.key"
                        class="pcf-requirement-item"
                        :class="req.met ? 'met' : 'unmet'"
                    >
                        <UIcon
                            :name="
                                req.met
                                    ? 'i-lucide-circle-check'
                                    : 'i-lucide-circle'
                            "
                            class="mr-1 shrink-0 size-[14px]"
                        />
                        <span class="text-xs">
                            {{ $t(`account.requirements.${req.key}`) }}
                        </span>
                    </div>
                </div>
            </div>
        </Transition>

        <UserPasswordField
            :model-value="passwordConfirm"
            :size="size"
            :label="$t('account.confirmPassword')"
            :placeholder="$t('account.placeholders.confirmPassword')"
            autocomplete="new-password"
            :hide-toggle="passwordsMatch"
            validate-on="blur"
            :rules="[rules.required, rules.matchPassword]"
            icon="i-lucide-lock-keyhole"
            data-testid="password-confirm"
            @update:model-value="emit('update:passwordConfirm', $event)"
        >
            <template #append-inner>
                <UIcon
                    name="i-lucide-circle-check"
                    class="text-success size-[20px]"
                    v-if="passwordsMatch"
                />
            </template>
        </UserPasswordField>
    </div>
</template>

<script setup lang="ts">
import type { InputProps } from '@nuxt/ui'
import {
    required,
    minLength,
    passwordsMatch as makePasswordsMatchRule,
} from '~/utils/validation'
const props = withDefaults(
    defineProps<{
        requireOldPassword?: boolean
        oldPassword?: string
        password?: string
        passwordConfirm?: string
        size?: InputProps['size']
    }>(),
    {
        requireOldPassword: true,
        oldPassword: '',
        password: '',
        passwordConfirm: '',
    },
)

const emit = defineEmits<{
    'update:oldPassword': [value: string]
    'update:password': [value: string]
    'update:passwordConfirm': [value: string]
    validity: [valid: boolean]
}>()

// ── i18n ──────────────────────────────────────────────────────────────────
const { t } = useI18n()

// ── Strength logic ────────────────────────────────────────────────────────
const passwordRequirements = computed(() => [
    { key: 'minLength', met: [...props.password].length >= 8 },
    { key: 'uppercase', met: /[A-Z]/.test(props.password) },
    { key: 'lowercase', met: /[a-z]/.test(props.password) },
    { key: 'number', met: /\d/.test(props.password) },
    {
        key: 'special',
        met: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(props.password),
    },
])

const strengthScore = computed(() => {
    if (!props.password) return 0
    const met = passwordRequirements.value.filter((r) => r.met).length
    if (met <= 1) return 1
    if (met <= 2) return 2
    if (met <= 3) return 3
    return 4
})

const strengthLabel = computed(
    () => ['', 'weak', 'fair', 'good', 'strong'][strengthScore.value] ?? 'weak',
)

const strengthClasses = computed(
    () =>
        [
            { text: 'text-error', bg: 'bg-error' },
            { text: 'text-error', bg: 'bg-error' },
            { text: 'text-warning', bg: 'bg-warning' },
            { text: 'text-info', bg: 'bg-info' },
            { text: 'text-success', bg: 'bg-success' },
        ][strengthScore.value] ?? { text: 'text-error', bg: 'bg-error' },
)

const passwordsMatch = computed(
    () => !!(props.passwordConfirm && props.password === props.passwordConfirm),
)

const rules = {
    required: required(t),
    minLength: minLength(t, 8),
    matchPassword: makePasswordsMatchRule(t, () => props.password),
    strength: () => strengthScore.value >= 3 || t('validation.passwordTooWeak'),
}

const isValid = computed(() => {
    const baseOk =
        [...props.password].length >= 8 &&
        strengthScore.value >= 3 &&
        passwordsMatch.value

    return props.requireOldPassword ? baseOk && !!props.oldPassword : baseOk
})

watch(isValid, (val) => emit('validity', val), { immediate: true })
</script>

<style scoped>
.pcf-strength-track {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
}
.pcf-strength-segment {
    height: 4px;
    border-radius: 2px;
    transition: background-color 0.35s ease;
}
.pcf-segment-empty {
    background-color: color-mix(
        in oklab,
        var(--ui-text-highlighted) 12%,
        transparent
    );
}

.pcf-requirements-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
}
.pcf-requirement-item {
    display: flex;
    align-items: center;
    transition: color 0.2s;
}
.pcf-requirement-item.met {
    color: var(--ui-success);
}
.pcf-requirement-item.unmet {
    color: var(--ui-text-muted);
}

.pcf-slide-down-enter-active,
.pcf-slide-down-leave-active {
    transition:
        opacity 0.25s ease,
        max-height 0.25s ease;
    overflow: hidden;
}
.pcf-slide-down-enter-from,
.pcf-slide-down-leave-to {
    opacity: 0;
    max-height: 0;
}
.pcf-slide-down-enter-to,
.pcf-slide-down-leave-from {
    opacity: 1;
    max-height: 220px;
}
</style>
