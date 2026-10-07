import {
    WEEKDAYS,
    hasOpeningHours,
    openStatus,
    weekdayOf,
    type GymOpeningHours,
    type Weekday,
} from '#shared/utils/openingHours'

export function weekdayName(
    day: Weekday,
    locale: string,
    format: 'long' | 'short' = 'long',
) {
    const monday = new Date(2026, 9, 5)
    monday.setDate(monday.getDate() + WEEKDAYS.indexOf(day))
    return new Intl.DateTimeFormat(locale, { weekday: format }).format(monday)
}

// The clock only starts after mount, so SSR and hydration render the same markup.
export function useOpenStatus(
    hours: MaybeRefOrGetter<GymOpeningHours | null | undefined>,
) {
    const { t, locale } = useI18n()
    const now = ref<Date | null>(null)
    let timer: ReturnType<typeof setInterval> | undefined
    onMounted(() => {
        now.value = new Date()
        timer = setInterval(() => (now.value = new Date()), 60_000)
    })
    onBeforeUnmount(() => clearInterval(timer))

    const status = computed(() => {
        const value = toValue(hours)
        return now.value && hasOpeningHours(value)
            ? openStatus(value, now.value)
            : null
    })
    const today = computed(() => (now.value ? weekdayOf(now.value) : null))
    const label = computed(() => {
        const s = status.value
        if (!s) return ''
        if (s.open) return t('gymInfo.openUntil', { time: s.until })
        if (s.opensOn)
            return t('gymInfo.opensOn', {
                day: weekdayName(s.opensOn, locale.value, 'short'),
                time: s.opensAt,
            })
        if (s.opensAt) return t('gymInfo.opensAt', { time: s.opensAt })
        return t('gymInfo.closed')
    })
    return { status, today, label }
}
