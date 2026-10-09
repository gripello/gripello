<script setup lang="ts">
import type { Rule } from '~/utils/validation'

defineOptions({ inheritAttrs: false })

const password = defineModel<string>({ default: '' })

const props = withDefaults(
    defineProps<{
        label: string
        name?: string
        icon?: string
        placeholder?: string
        autocomplete?: string
        hideToggle?: boolean
        rules?: Rule[]
        validateOn?: 'input' | 'blur'
    }>(),
    { autocomplete: 'current-password', validateOn: 'input' },
)

const visible = ref(false)
const touched = ref(false)

const ruleError = computed(() => {
    if (!touched.value || !props.rules) return undefined
    const message = props.rules
        .map((rule) => rule(password.value))
        .find((result) => result !== true)
    return message || undefined
})

watch(password, () => {
    if (props.validateOn === 'input') touched.value = true
})

function toggleVisibility() {
    visible.value = !visible.value
}
</script>

<template>
    <UFormField :label="label" :name="name" :error="ruleError">
        <UInput
            v-model="password"
            v-bind="$attrs"
            :type="visible ? 'text' : 'password'"
            :autocomplete="autocomplete"
            :name="name"
            :placeholder="placeholder"
            :icon="icon"
            class="w-full"
            @blur="touched = true"
        >
            <template #trailing>
                <slot name="append-inner" />
                <UButton
                    v-if="!hideToggle"
                    :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    color="neutral"
                    variant="link"
                    size="sm"
                    :aria-label="
                        visible
                            ? $t('account.hidePassword')
                            : $t('account.showPassword')
                    "
                    data-testid="password-toggle"
                    @click="toggleVisibility"
                />
            </template>
        </UInput>
    </UFormField>
</template>
