<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { pushDialogEntry } from '~/utils/dialogHistory'

defineOptions({ inheritAttrs: false })

const open = defineModel<boolean>({ default: false })

const props = withDefaults(
    defineProps<{
        title?: string
        subtitle?: string
        maxWidth?: string | number
        persistent?: boolean
        closable?: boolean
        scrollable?: boolean
        flush?: boolean
        sheetOnMobile?: boolean
        submitLabel?: string
        submitIcon?: string
        submitColor?: ButtonProps['color']
        submitLoading?: boolean
        submitDisabled?: boolean
        submitForm?: string
        submitTestId?: string
        cancelTestId?: string
        captcha?: boolean
        onCancel?: () => void
    }>(),
    { maxWidth: 520, scrollable: true, submitColor: 'primary' },
)

const emit = defineEmits<{ submit: [] }>()

function cancel() {
    if (props.onCancel) props.onCancel()
    else open.value = false
}

const captchaRunning = computed(() => props.captcha && props.submitLoading)

const { smAndUp } = useDisplay()
const prefersSheet = computed(() => props.sheetOnMobile && !smAndUp.value)
const asSheet = ref(prefersSheet.value)
const rendered = ref(open.value)
watch(
    open,
    (isOpen) => {
        if (!isOpen) return
        asSheet.value = prefersSheet.value
        rendered.value = true
    },
    { flush: 'sync' },
)
let releaseHistoryEntry: (() => void) | undefined
watch(
    open,
    (isOpen) => {
        if (isOpen && !props.persistent && import.meta.client)
            releaseHistoryEntry ??= pushDialogEntry(() => (open.value = false))
        else if (!isOpen) {
            releaseHistoryEntry?.()
            releaseHistoryEntry = undefined
        }
    },
    { immediate: true },
)
onBeforeUnmount(() => releaseHistoryEntry?.())
watch(prefersSheet, (sheet) => {
    if (!open.value) asSheet.value = sheet
})
const modal = resolveComponent('UModal')
const drawer = resolveComponent('UDrawer')
const overlay = computed(() => (asSheet.value ? drawer : modal))
const widthStyle = computed(() => ({
    '--dialog-width': /^\d+$/.test(String(props.maxWidth))
        ? `${props.maxWidth}px`
        : props.maxWidth,
}))
const activatorProps = { onClick: () => (open.value = true) }
const shell = ref<HTMLElement>()
const sheetListeners = {
    'after:enter': () => shell.value?.focus({ preventScroll: true }),
}
</script>

<template>
    <slot name="activator" :props="activatorProps" :is-active="open" />
    <component
        :is="overlay"
        v-if="rendered"
        v-model:open="open"
        :title="title || ' '"
        :description="subtitle"
        :dismissible="!persistent"
        v-bind="asSheet ? { noBodyStyles: true } : {}"
        v-on="asSheet ? sheetListeners : {}"
        :content="
            asSheet
                ? { disableOutsidePointerEvents: true }
                : { style: widthStyle }
        "
        :ui="{
            content: asSheet
                ? undefined
                : 'sm:max-w-(--dialog-width) rounded-xl',
        }"
    >
        <template #content>
            <div
                v-bind="$attrs"
                ref="shell"
                tabindex="-1"
                class="dialog-shell flex min-h-0 flex-1 flex-col outline-none"
                :class="asSheet && 'pb-[env(safe-area-inset-bottom)]'"
            >
                <div
                    v-if="title || $slots.title"
                    class="dialog-shell__title flex items-center gap-2 p-5 pb-2 text-base font-semibold"
                >
                    <slot name="title">{{ title }}</slot>
                    <div class="flex-1" />
                    <slot name="header-actions" />
                    <UButton
                        v-if="closable"
                        icon="i-lucide-x"
                        color="neutral"
                        variant="ghost"
                        class="icon-btn"
                        :aria-label="$t('actions.close')"
                        data-testid="dialog-close"
                        @click="open = false"
                    />
                </div>

                <p v-if="subtitle" class="px-5 pb-1 text-sm text-muted">
                    {{ subtitle }}
                </p>

                <div
                    class="min-h-0"
                    :class="[
                        scrollable && 'overflow-y-auto',
                        flush
                            ? 'p-0'
                            : title || $slots.title
                              ? 'p-5 pt-2'
                              : 'p-5',
                    ]"
                >
                    <slot />
                </div>

                <div
                    v-if="$slots.actions || submitLabel != null"
                    class="flex items-center gap-2 p-4 pt-0"
                >
                    <slot name="actions">
                        <UButton
                            color="neutral"
                            variant="ghost"
                            :data-testid="cancelTestId"
                            @click="cancel"
                        >
                            {{ $t('actions.cancel') }}
                        </UButton>
                        <slot name="footer-start" />
                        <div class="flex-1" />
                        <UButton
                            :type="submitForm ? 'submit' : 'button'"
                            :form="submitForm"
                            :color="submitColor"
                            :icon="captcha ? undefined : submitIcon"
                            :loading="!captcha && submitLoading"
                            :disabled="submitDisabled || captchaRunning"
                            :data-testid="submitTestId"
                            @click="submitForm || emit('submit')"
                        >
                            <CaptchaLoader v-if="captchaRunning" />
                            <template v-else>{{ submitLabel }}</template>
                        </UButton>
                    </slot>
                </div>
            </div>
        </template>
    </component>
</template>

<style>
.dialog-shell__title {
    white-space: normal;
}
</style>
