<template>
    <section :class="{ 'mb-6': videos.length }" data-testid="beta-videos">
        <h2
            v-if="videos.length"
            class="mb-3 flex items-center gap-2 text-base font-bold"
        >
            {{ t('beta.title') }}
            <UBadge
                v-if="videos.length"
                variant="soft"
                color="primary"
                class="rounded-full"
            >
                {{ videos.length }}
            </UBadge>
        </h2>

        <LayoutScrollStrip
            v-if="videos.length"
            class="[--beta-height:min(60vh,28rem)]"
            data-testid="beta-list"
        >
            <RouteBetaTile
                v-for="video in visibleVideos"
                :id="`beta-${video.id}`"
                :key="video.id"
                :video="video"
                :deletable="canDelete(video)"
                :highlighted="video.id === targetId"
                class="shrink-0 snap-start"
                @report="reportTarget = video.id"
                @delete="deleteTarget = video"
            />
        </LayoutScrollStrip>

        <LayoutDialogShell
            v-model="addOpen"
            max-width="480"
            closable
            sheet-on-mobile
            :title="t('beta.add')"
            data-testid="beta-dialog"
        >
            <div class="flex flex-col gap-4">
                <SegmentedControl
                    v-model="source"
                    :items="sourceItems"
                    size="sm"
                    class="self-center"
                    test-id="beta-source"
                />
                <template v-if="source === 'link'">
                    <UFormField :label="t('beta.link')" :error="linkError">
                        <UInput
                            v-model="link"
                            type="url"
                            inputmode="url"
                            :icon="linkIcon"
                            placeholder="https://www.tiktok.com/…"
                            class="w-full"
                            autofocus
                            data-testid="beta-link"
                        />
                    </UFormField>
                </template>
                <template v-else-if="file">
                    <div
                        class="overflow-hidden rounded-lg ring ring-default [&_video]:max-h-[45vh]"
                        data-testid="beta-file-preview"
                    >
                        <RouteBetaPlayer :src="fileUrl" />
                    </div>
                    <p class="flex items-center gap-2 text-sm">
                        <UIcon
                            name="i-lucide-film"
                            class="size-4 shrink-0 text-muted"
                        />
                        <span class="min-w-0 flex-1 truncate font-medium">{{
                            file.name
                        }}</span>
                        <span class="shrink-0 text-muted tabular-nums">{{
                            megabytes(file.size)
                        }}</span>
                        <UButton
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-refresh-cw"
                            class="icon-btn shrink-0"
                            :aria-label="t('beta.chooseOther')"
                            @click="file = null"
                        />
                    </p>
                    <p
                        v-if="fileError"
                        class="text-sm text-error"
                        data-testid="beta-file-error"
                    >
                        {{ fileError }}
                    </p>
                </template>
                <label
                    v-else
                    class="flex h-48 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 text-center transition"
                    :class="
                        dragging
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-default text-muted hover:border-primary hover:text-primary'
                    "
                    @dragover.prevent="dragging = true"
                    @dragleave="dragging = false"
                    @drop.prevent="onDrop"
                >
                    <span
                        class="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary"
                    >
                        <UIcon name="i-lucide-upload" class="size-7" />
                    </span>
                    <span class="text-sm font-semibold">{{
                        t('beta.drop')
                    }}</span>
                    <input
                        type="file"
                        class="sr-only"
                        :accept="BETA_VIDEO_TYPES.join(',')"
                        data-testid="beta-file"
                        @change="onPick"
                    />
                </label>
            </div>

            <template #actions>
                <UButton
                    color="neutral"
                    variant="ghost"
                    @click="addOpen = false"
                >
                    {{ t('actions.cancel') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    color="primary"
                    icon="i-lucide-send"
                    :loading="saving"
                    :disabled="!canSubmit"
                    data-testid="beta-submit"
                    @click="submit"
                >
                    {{ t('beta.submit') }}
                </UButton>
            </template>
        </LayoutDialogShell>

        <ReportsFormDialog
            v-if="reportTarget"
            :model-value="!!reportTarget"
            content-type="beta_video"
            :content-id="reportTarget"
            :content-url="reportContentUrl('beta_video', reportTarget, routeId)"
            @update:model-value="reportTarget = null"
        />

        <ConfirmDialog
            :model-value="!!deleteTarget"
            :title="t('actions.confirm')"
            :message="t('beta.deleteConfirm')"
            :loading="deleting"
            @update:model-value="deleteTarget = null"
            @confirm="confirmDelete"
        />
    </section>
</template>

<script setup lang="ts">
import { createBeta, deleteBeta, listBetas } from '~/api/ratings'
import type { BetaVideoRecord } from '~/types/models'
import {
    BETA_VIDEO_MAX_BYTES,
    BETA_VIDEO_TYPES,
    betaPlatformIcon,
    betaVideoPlatform,
} from '#shared/utils/betaVideos'
import { reportContentUrl } from '~/utils/reports'

const props = defineProps<{ routeId: string }>()

defineExpose({ openAdd })

const { t, locale } = useI18n()
const authStore = useAuthStore()
const currentRoute = useRoute()
const { pending: saving, run } = useAsyncAction()
const { pending: deleting, run: runDelete } = useAsyncAction()
const { isBlocked } = useBlocks()
const visibleVideos = computed(() =>
    videos.value.filter((video) => !isBlocked(video.author?.id)),
)
const { success: notifySuccess } = useNotification()

const { data: videos, refresh } = useAsyncData(
    `beta-videos:${props.routeId}`,
    () => listBetas(props.routeId),
    { default: () => [] },
)

const targetId = ref('')
onMounted(() => {
    if (window.location.hash.startsWith('#beta-'))
        targetId.value = window.location.hash.slice('#beta-'.length)
})
const stopScroll = watch(
    () => videos.value.some((video) => video.id === targetId.value),
    async (found) => {
        if (!found) return
        await nextTick()
        document
            .getElementById(`beta-${targetId.value}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        stopScroll()
    },
)

const addOpen = ref(false)
const source = ref<'link' | 'file'>('link')
const sourceItems = computed(() => [
    { value: 'link' as const, label: t('beta.link') },
    { value: 'file' as const, label: t('beta.file') },
])
const link = ref('')
const file = ref<File | null>(null)
const dragging = ref(false)
const fileUrl = ref('')
watch(file, (picked) => {
    if (fileUrl.value) URL.revokeObjectURL(fileUrl.value)
    fileUrl.value = picked ? URL.createObjectURL(picked) : ''
})
onBeforeUnmount(() => {
    if (fileUrl.value) URL.revokeObjectURL(fileUrl.value)
})
const linkIcon = computed(() =>
    betaPlatformIcon(link.value.trim(), 'i-lucide-link'),
)
const megabytes = (bytes: number) =>
    `${(bytes / 1024 / 1024).toLocaleString(locale.value, { maximumFractionDigits: 1 })} MB`

function onPick(event: Event) {
    file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

function onDrop(event: DragEvent) {
    dragging.value = false
    const dropped = event.dataTransfer?.files[0]
    if (dropped && BETA_VIDEO_TYPES.includes(dropped.type)) file.value = dropped
}
const linkError = computed(() =>
    link.value.trim() && !betaVideoPlatform(link.value.trim())
        ? t('beta.invalidLink')
        : undefined,
)
const fileError = computed(() =>
    file.value && file.value.size > BETA_VIDEO_MAX_BYTES
        ? t('beta.fileTooLarge', { size: BETA_VIDEO_MAX_BYTES / 1024 / 1024 })
        : undefined,
)
const canSubmit = computed(() =>
    source.value === 'link'
        ? !!betaVideoPlatform(link.value.trim())
        : !!file.value && !fileError.value,
)

function openAdd() {
    if (!authStore.isValid) {
        void navigateTo({
            path: '/auth/login',
            query: { redirect: currentRoute.fullPath },
        })
        return
    }
    link.value = ''
    file.value = null
    source.value = 'link'
    addOpen.value = true
}

async function submit() {
    const created = await run(() =>
        createBeta(
            props.routeId,
            source.value === 'link'
                ? { url: link.value.trim() }
                : { file: file.value! },
        ),
    )
    if (!created) return
    notifySuccess(
        'pending' in created ? t('beta.awaitingApproval') : t('beta.added'),
    )
    addOpen.value = false
    await refresh()
}

function canDelete(video: BetaVideoRecord) {
    return video.user === authStore.record?.id
}

const reportTarget = ref<string | null>(null)
const deleteTarget = ref<BetaVideoRecord | null>(null)

async function confirmDelete() {
    const video = deleteTarget.value
    if (!video) return
    await runDelete(() => deleteBeta(video.id), {
        success: t('beta.deleted'),
    })
    deleteTarget.value = null
    await refresh()
}
</script>
