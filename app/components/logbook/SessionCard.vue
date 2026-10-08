<template>
    <div
        class="h-full rounded-lg bg-default ring ring-default"
        :data-testid="testId ?? `logbook-day-${day}`"
    >
        <slot name="header" />
        <button
            type="button"
            class="session-card__header p-4"
            :aria-expanded="open"
            data-testid="logbook-session-toggle"
            @click="open = !open"
        >
            <div class="grow text-left">
                <h2 class="text-sm font-bold mb-2">
                    {{ formattedDay }}
                </h2>
                <div class="flex flex-wrap gap-2">
                    <UBadge color="neutral" variant="soft" icon="i-lucide-list">
                        {{
                            $t('ticks.session.climbs', {
                                count: summary.climbs,
                            })
                        }}
                    </UBadge>
                    <UBadge
                        color="success"
                        variant="soft"
                        icon="i-lucide-flag-triangle-right"
                        data-testid="logbook-session-sends"
                    >
                        {{ $t('ticks.sendCount', { count: summary.sends }) }}
                    </UBadge>
                    <UBadge
                        v-if="summary.flashes"
                        color="warning"
                        variant="soft"
                        icon="i-lucide-zap"
                    >
                        {{
                            $t('ticks.session.flashes', {
                                count: summary.flashes,
                            })
                        }}
                    </UBadge>
                    <UBadge
                        v-for="best in summary.hardest"
                        :key="best.kind"
                        color="primary"
                        variant="soft"
                        icon="i-lucide-trending-up"
                        :data-testid="`logbook-session-hardest-${best.kind}`"
                    >
                        {{
                            $t('ticks.session.hardest', {
                                grade: gradeKey(best, true),
                            })
                        }}
                    </UBadge>
                </div>
            </div>
            <UIcon
                :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                class="size-6"
            />
        </button>
        <div v-show="open" class="px-4 pb-2">
            <USeparator class="mb-1" />
            <template v-for="(tick, index) in ticks" :key="tick.id">
                <USeparator v-if="index" />
                <LogbookTickRow
                    :tick="tick"
                    :readonly="readonly"
                    @edit="emit('edit', $event)"
                    @delete="emit('delete', $event)"
                />
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { RouteRecord, TickRecord } from '~/types/models'
import { formatDate } from '#shared/utils/formatting'
import { gradeKey } from '#shared/utils/grades'
import { sessionSummary } from '#shared/utils/logbook'
import { tickDate } from '#shared/utils/ticks'

const props = defineProps<{
    day: string
    ticks: (TickRecord & { expand?: { route?: RouteRecord } })[]
    initiallyOpen?: boolean
    readonly?: boolean
    testId?: string
}>()

const emit = defineEmits<{
    edit: [tick: TickRecord]
    delete: [tick: TickRecord]
}>()

const { locale } = useI18n()
const open = ref(props.initiallyOpen ?? false)

const summary = computed(() => sessionSummary(props.ticks))
const formattedDay = computed(() =>
    formatDate(tickDate(props.day), {
        locale: locale.value,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }),
)
</script>

<style scoped>
.session-card__header {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    color: inherit;
    background: none;
    border: 0;
    cursor: pointer;
}
</style>
