import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, toValue } from 'vue'
import { mount } from '@vue/test-utils'
import { useMountedNow } from '~/composables/useMountedNow'
import { useOpenStatus, weekdayName } from '~/composables/useOpenStatus'
import type { GymOpeningHours } from '#shared/utils/openingHours'

beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('useMountedNow', useMountedNow)
    vi.stubGlobal('toValue', toValue)
    vi.stubGlobal('useI18n', () => ({
        locale: ref('en'),
        t: (key: string, params: Record<string, string> = {}) =>
            `${key} ${Object.values(params).join(' ')}`.trim(),
    }))
})

afterEach(() => vi.useRealTimers())

function statusAt(iso: string, hours: GymOpeningHours | null) {
    vi.setSystemTime(new Date(iso))
    let state!: ReturnType<typeof useOpenStatus>
    let ssrLabel = 'unset'
    mount(
        defineComponent({
            setup() {
                state = useOpenStatus(() => hours)
                ssrLabel = state.label.value
                return () => h('div')
            },
        }),
    )
    return { ...state, ssrLabel }
}

// 2026-10-21 is a Wednesday
const HOURS: GymOpeningHours = {
    wed: [['10:00', '22:00']],
    fri: [['18:00', '02:00']],
}

describe('useOpenStatus', () => {
    it('renders no status before mount so SSR never shows the server clock', () => {
        expect(statusAt('2026-10-21T12:00:00', HOURS).ssrLabel).toBe('')
    })

    it('says until when the gym closes', () => {
        const { label, today } = statusAt('2026-10-21T12:00:00', HOURS)
        expect(label.value).toBe('gymInfo.openUntil 22:00')
        expect(today.value).toBe('wed')
    })

    it('says when it opens later today or on which day', () => {
        expect(statusAt('2026-10-21T08:00:00', HOURS).label.value).toBe(
            'gymInfo.opensAt 10:00',
        )
        expect(statusAt('2026-10-21T23:00:00', HOURS).label.value).toBe(
            'gymInfo.opensOn Fri 18:00',
        )
    })

    it('keeps a late-night session open past midnight', () => {
        expect(statusAt('2026-10-24T01:00:00', HOURS).label.value).toBe(
            'gymInfo.openUntil 02:00',
        )
    })

    it('shows nothing without opening hours', () => {
        expect(statusAt('2026-10-21T12:00:00', null).label.value).toBe('')
    })

    it('names weekdays in the viewer language', () => {
        expect(weekdayName('mon', 'de')).toBe('Montag')
        expect(weekdayName('sun', 'en', 'short')).toBe('Sun')
    })
})
