<template>
    <div
        class="-mx-4 flex gap-3 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:p-0 xl:grid-cols-5"
        data-testid="platform-user-kpis"
    >
        <button
            v-for="card in cards"
            :key="card.filter ?? 'all'"
            type="button"
            class="w-44 shrink-0 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-primary md:w-auto"
            :class="{ 'ring-2 ring-primary': filter === card.filter }"
            :aria-pressed="filter === card.filter"
            :data-testid="`platform-user-kpi-${card.filter ?? 'all'}`"
            @click="filter = filter === card.filter ? null : card.filter"
        >
            <LayoutStatCard
                :title="card.title"
                :value="summary ? card.value : null"
                :icon="card.icon"
                :color="card.color"
                :subtitle="card.subtitle"
                :meter="card.meter"
                :loading="!summary"
                :format="(n: number) => formatNumber(n, locale, 0)"
                class="h-full"
            />
        </button>
    </div>
</template>

<script setup lang="ts">
import type { PlatformUserSummary } from '~/api/platform'
import { formatNumber, formatPercent } from '#shared/utils/number'
import type { PlatformUserFilter } from '~/utils/platformUsers'

const props = defineProps<{ summary?: PlatformUserSummary | null }>()
const filter = defineModel<PlatformUserFilter | null>({ required: true })

const { t, locale } = useI18n()

const cards = computed(() => {
    const s = props.summary
    const total = s?.total || 0
    return [
        {
            filter: null,
            title: t('platform.users.kpis.accounts'),
            value: total,
            icon: 'i-lucide-users',
            color: 'primary',
            subtitle: s
                ? t('platform.users.kpis.newThisWeek', { n: s.new_7d })
                : '',
            meter: null,
        },
        {
            filter: 'active' as const,
            title: t('platform.users.kpis.active'),
            value: s?.active_7d ?? 0,
            icon: 'i-lucide-activity',
            color: 'info',
            subtitle: s
                ? t('platform.users.kpis.online', { n: s.online }) +
                  (total
                      ? ` · ${formatPercent(s.active_7d / total, locale.value)}`
                      : '')
                : '',
            meter: total ? (s?.active_7d ?? 0) / total : null,
        },
        {
            filter: 'staff_no_mfa' as const,
            title: t('platform.users.kpis.staffNoMfa'),
            value: s?.staff_no_mfa ?? 0,
            icon: 'i-lucide-shield-off',
            color: s?.staff_no_mfa ? 'warning' : 'success',
            subtitle: s ? t('platform.users.kpis.ofStaff', { n: s.staff }) : '',
            meter: null,
        },
        {
            filter: 'unverified' as const,
            title: t('platform.users.unverified'),
            value: s?.unverified ?? 0,
            icon: 'i-lucide-mail-warning',
            color: 'warning',
            subtitle: s
                ? t('platform.users.kpis.olderThanWeek', {
                      n: s.unverified_old,
                  })
                : '',
            meter: null,
        },
        {
            filter: 'suspended' as const,
            title: t('platform.overview.suspended'),
            value: s?.suspended ?? 0,
            icon: 'i-lucide-ban',
            color: 'error',
            subtitle: s ? t('platform.users.kpis.locked', { n: s.locked }) : '',
            meter: null,
        },
    ]
})
</script>
