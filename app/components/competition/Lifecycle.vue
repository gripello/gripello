<template>
    <LayoutPanel class="mb-6" data-testid="competition-lifecycle">
        <div class="flex flex-wrap items-center gap-2">
            <UBadge
                :icon="PHASE_ICONS[phase]"
                :color="COMPETITION_PHASE_COLORS[phase]"
                variant="soft"
                size="lg"
                class="me-auto"
                data-testid="competition-phase"
                >{{ $t(`competitions.phases.${phase}.title`) }}</UBadge
            >
            <UButton
                v-if="actions.primary"
                :icon="ACTION_ICONS[actions.primary]"
                color="primary"
                :disabled="actions.primary === 'open' && !ready"
                :loading="pending"
                :data-testid="`competition-action-${actions.primary}`"
                @click="request(actions.primary)"
            >
                {{ $t(`competitions.actions.${actions.primary}`) }}
            </UButton>
            <UDropdownMenu v-if="secondaryItems.length" :items="secondaryItems">
                <UButton
                    icon="i-lucide-ellipsis-vertical"
                    color="neutral"
                    variant="ghost"
                    class="icon-btn"
                    :aria-label="$t('routes.moreActions')"
                    data-testid="competition-lifecycle-more"
                />
            </UDropdownMenu>
        </div>

        <UStepper
            :model-value="phase"
            :items="phaseItems"
            size="sm"
            disabled
            class="w-full max-sm:hidden"
            :ui="{ description: 'hidden' }"
        />

        <ul
            v-if="competition.status === 'draft'"
            class="flex flex-wrap gap-x-5 gap-y-1"
            data-testid="competition-checklist"
        >
            <li v-for="item in checklist" :key="item.step">
                <UButton
                    :icon="
                        item.done ? 'i-lucide-circle-check' : 'i-lucide-circle'
                    "
                    :color="item.done ? 'success' : 'neutral'"
                    variant="link"
                    class="px-0"
                    :data-testid="`competition-checklist-${item.step}`"
                    :data-done="item.done"
                    @click="emit('goto', item.step)"
                >
                    {{ $t(`competitions.checklist.${item.step}`) }}
                </UButton>
            </li>
        </ul>

        <div v-if="shareUrl">
            <UPopover>
                <UButton
                    icon="i-lucide-share-2"
                    color="neutral"
                    variant="outline"
                    data-testid="competition-share"
                    @click="renderQr"
                >
                    {{ $t('competitions.share') }}
                </UButton>
                <template #content>
                    <div
                        class="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 p-4"
                    >
                        <UInput
                            :model-value="shareUrl"
                            readonly
                            icon="i-lucide-link"
                            :ui="{ base: 'text-ellipsis' }"
                            :aria-label="$t('competitions.shareLink')"
                            data-testid="competition-share-url"
                        />
                        <UButton
                            icon="i-lucide-copy"
                            color="neutral"
                            variant="outline"
                            block
                            data-testid="competition-share-copy"
                            @click="copyLink"
                        >
                            {{ $t('competitions.copyLink') }}
                        </UButton>
                        <img
                            v-if="qrDataUrl"
                            :src="qrDataUrl"
                            :alt="$t('competitions.qrCode')"
                            class="mx-auto size-56"
                            data-testid="competition-share-qr"
                        />
                    </div>
                </template>
            </UPopover>
        </div>

        <ConfirmDialog
            v-model="confirmOpen"
            :title="
                pendingAction
                    ? $t(`competitions.actions.${pendingAction}`)
                    : undefined
            "
            :message="
                pendingAction
                    ? $t(`competitions.confirm.${pendingAction}`)
                    : undefined
            "
            :confirm-text="
                pendingAction
                    ? $t(`competitions.actions.${pendingAction}`)
                    : undefined
            "
            confirm-color="primary"
            :loading="pending"
            @confirm="confirm"
        />
    </LayoutPanel>
</template>

<script setup lang="ts">
import {
    COMPETITION_PHASES,
    COMPETITION_PHASE_COLORS,
    competitionPhase,
    competitionShareUrl,
    LIFECYCLE_TARGET,
    lifecycleActions,
    type LifecycleAction,
    type SetupStep,
} from '~/utils/competitions'
import type { CompetitionRecord, CompetitionStatus } from '~/types/models'

const PHASE_ICONS = {
    draft: 'i-lucide-pencil-line',
    registration: 'i-lucide-user-plus',
    running: 'i-lucide-play',
    ended: 'i-lucide-flag',
    published: 'i-lucide-trophy',
} as const

const ACTION_ICONS: Record<LifecycleAction, string> = {
    open: 'i-lucide-user-plus',
    close: 'i-lucide-lock',
    publish: 'i-lucide-trophy',
    reopen: 'i-lucide-lock-open',
    unpublish: 'i-lucide-eye-off',
    backToDraft: 'i-lucide-pencil-line',
}

const props = defineProps<{
    competition: CompetitionRecord
    checklist: { step: SetupStep; done: boolean }[]
    pending?: boolean
}>()

const emit = defineEmits<{
    goto: [step: SetupStep]
    status: [status: CompetitionStatus]
}>()

const { t } = useI18n()
const { success } = useNotification()
const requestUrl = useRequestURL({
    xForwardedHost: true,
    xForwardedProto: true,
})

const confirmOpen = ref(false)
const pendingAction = ref<LifecycleAction | null>(null)
const qrDataUrl = ref('')
const now = ref(new Date())

const phase = computed(() => competitionPhase(props.competition, now.value))
const actions = computed(() => lifecycleActions(props.competition.status))
const ready = computed(() => props.checklist.every((item) => item.done))
const secondaryItems = computed(() =>
    actions.value.secondary.map((action) => ({
        label: t(`competitions.actions.${action}`),
        icon: ACTION_ICONS[action],
        'data-testid': `competition-action-${action}`,
        onSelect: () => request(action),
    })),
)

const phaseItems = computed(() =>
    COMPETITION_PHASES.map((value) => ({
        value,
        title: t(`competitions.phases.${value}.title`),
        icon: PHASE_ICONS[value],
    })),
)

const { slug: gymSlug } = useGym()

const shareUrl = computed(() =>
    props.competition.status === 'draft'
        ? ''
        : competitionShareUrl(
              requestUrl.origin,
              gymSlug.value,
              props.competition.id,
          ),
)

let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    clock = setInterval(() => (now.value = new Date()), 60_000)
})
onBeforeUnmount(() => clearInterval(clock))

function request(action: LifecycleAction) {
    pendingAction.value = action
    confirmOpen.value = true
}

function confirm() {
    if (!pendingAction.value) return
    emit('status', LIFECYCLE_TARGET[pendingAction.value])
    confirmOpen.value = false
}

async function copyLink() {
    await navigator.clipboard.writeText(shareUrl.value)
    success(t('competitions.linkCopied'))
}

async function renderQr() {
    if (qrDataUrl.value) return
    const { default: QRCode } = await import('qrcode')
    qrDataUrl.value = await QRCode.toDataURL(shareUrl.value, {
        width: 448,
        margin: 1,
    })
}
</script>
