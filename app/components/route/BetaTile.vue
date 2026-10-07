<template>
    <article
        class="max-w-full overflow-hidden rounded-2xl bg-elevated/50 ring transition-shadow duration-700"
        :style="{
            width: `calc(var(--beta-height, min(70vh, 32rem)) * ${ratio})`,
        }"
        :class="highlighted ? 'ring-4 ring-primary' : 'ring-default'"
        :data-testid="`beta-video-${video.id}`"
        :data-highlighted="highlighted || undefined"
    >
        <header class="flex items-center gap-3 py-2 ps-3 pe-1">
            <NuxtLink
                v-if="video.author"
                :to="`/climber?id=${video.author.id}`"
                class="shrink-0"
            >
                <ClimberAvatar
                    :id="video.author.id"
                    :name="video.author.name"
                    :avatar="video.author.avatar"
                />
            </NuxtLink>
            <span class="min-w-0 flex-1 leading-tight">
                <NuxtLink
                    v-if="video.author"
                    :to="`/climber?id=${video.author.id}`"
                    class="block truncate text-sm font-semibold text-highlighted hover:underline"
                    data-testid="beta-video-author"
                >
                    {{ video.author.name }}
                </NuxtLink>
                <span class="block truncate text-xs text-muted">
                    {{ timeAgo }}
                </span>
            </span>
            <UButton
                v-if="!deletable"
                icon="i-lucide-flag"
                color="neutral"
                variant="ghost"
                class="icon-btn"
                :aria-label="t('beta.report')"
                data-testid="beta-video-report"
                @click="$emit('report')"
            />
            <UButton
                v-else
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                class="icon-btn"
                :aria-label="t('actions.delete')"
                data-testid="beta-video-delete"
                @click="$emit('delete')"
            />
        </header>

        <div class="w-full" :style="{ aspectRatio: ratio }">
            <RouteBetaPlayer
                v-if="video.file"
                :src="usePbFileUrl(video, video.file)"
                @ratio="uploadRatio = $event"
            />
            <a
                v-else
                :href="video.url"
                target="_blank"
                rel="noopener noreferrer nofollow"
                class="group/link relative flex size-full flex-col items-center justify-center gap-3 bg-linear-to-br from-neutral-700 via-neutral-900 to-black text-white"
                data-testid="beta-video-link"
            >
                <UIcon :name="platformIcon" class="size-12 opacity-90" />
                <span
                    class="flex size-16 items-center justify-center rounded-full bg-white/15 backdrop-blur transition group-hover/link:scale-105 group-hover/link:bg-white/25"
                >
                    <UIcon name="i-lucide-play" class="ms-1 size-8" />
                </span>
                <span
                    class="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-linear-to-t from-black/80 to-transparent px-3 pt-8 pb-3 text-sm font-semibold"
                >
                    <span class="min-w-0 flex-1 truncate">
                        {{ t('beta.openOn', { platform: platform ?? '' }) }}
                    </span>
                    <UIcon
                        name="i-lucide-external-link"
                        class="size-4 shrink-0"
                    />
                </span>
            </a>
        </div>
    </article>
</template>

<script setup lang="ts">
import type { BetaVideoRecord } from '~/types/models'
import {
    BETA_LINK_RATIO,
    betaPlatformIcon,
    betaVideoPlatform,
} from '#shared/utils/betaVideos'
import { timeAgo as sharedTimeAgo } from '#shared/utils/formatting'

const props = defineProps<{
    video: BetaVideoRecord
    deletable?: boolean
    highlighted?: boolean
}>()

defineEmits<{ report: []; delete: [] }>()

const { t, locale } = useI18n()
const platform = computed(() => betaVideoPlatform(props.video.url ?? ''))
const platformIcon = computed(() =>
    betaPlatformIcon(props.video.url ?? '', 'i-lucide-circle-play'),
)
const uploadRatio = ref(9 / 16)
const ratio = computed(() =>
    props.video.file ? uploadRatio.value : BETA_LINK_RATIO,
)
const hydrated = useHydrated()
const timeAgo = computed(() =>
    hydrated.value ? sharedTimeAgo(props.video.created, t, locale.value) : '',
)
</script>
