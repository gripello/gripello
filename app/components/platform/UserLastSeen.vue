<template>
    <span
        class="inline-flex items-center gap-2"
        :data-tone="tone"
        data-testid="platform-user-last-seen"
    >
        <span class="relative flex size-2.5 shrink-0">
            <span
                v-if="tone === 'online'"
                class="absolute inset-0 animate-ping rounded-full bg-success opacity-60"
            />
            <span class="relative size-2.5 rounded-full" :class="DOTS[tone]" />
        </span>
        <span class="flex min-w-0 flex-col leading-tight">
            <span
                class="whitespace-nowrap"
                :class="
                    tone === 'online'
                        ? 'font-medium text-success'
                        : tone === 'never'
                          ? 'text-muted'
                          : 'text-default'
                "
            >
                {{ lastSeenLabel(lastSeen, t, locale, nowMs) }}
            </span>
            <span
                v-if="!compact && (tone === 'active' || tone === 'idle')"
                class="text-xs whitespace-nowrap text-muted"
            >
                {{
                    formatDate(lastSeen, {
                        locale,
                        withTime: true,
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                    })
                }}
            </span>
        </span>
    </span>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import {
    lastSeenLabel,
    lastSeenTone,
    type LastSeenTone,
} from '~/utils/platformUsers'

const props = defineProps<{ lastSeen?: string | null; compact?: boolean }>()

const { t, locale } = useI18n()

const DOTS: Record<LastSeenTone, string> = {
    online: 'bg-success',
    active: 'bg-info',
    idle: 'bg-accented ring-1 ring-inset ring-accented',
    dormant: 'ring-1 ring-inset ring-accented',
    never: 'border border-dashed border-accented',
}

const now = useMountedNow(30_000)
const nowMs = computed(() => now.value?.getTime() ?? Date.now())
const tone = computed(() => lastSeenTone(props.lastSeen, nowMs.value))
</script>
