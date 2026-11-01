import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import OpeningHoursEditor from '~/components/admin/OpeningHoursEditor.vue'
import { weekdayName } from '~/composables/useOpenStatus'
import {
    isValidOpeningHours,
    type GymOpeningHours,
} from '#shared/utils/openingHours'

beforeEach(() => {
    vi.stubGlobal('weekdayName', weekdayName)
    vi.stubGlobal('useI18n', () => ({
        t: (key: string) => key,
        locale: ref('en'),
    }))
})

function mountEditor(hours: GymOpeningHours) {
    const wrapper = mount(OpeningHoursEditor, {
        props: {
            modelValue: hours,
            'onUpdate:modelValue': (next: GymOpeningHours) =>
                wrapper.setProps({ modelValue: next }),
        },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UFormField: {
                    props: ['label'],
                    template: '<div><span>{{ label }}</span><slot /></div>',
                },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input v-bind="$attrs" :value="modelValue"
                        @change="$emit('update:modelValue', $event.target.value)" />`,
                },
                UButton: {
                    props: ['label'],
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')">{{ label }}</button>',
                },
                UBadge: {
                    props: ['label'],
                    template: '<em>{{ label }}</em>',
                },
            },
        },
    })
    const hoursNow = () => wrapper.props('modelValue') as GymOpeningHours
    const click = (testId: string) =>
        wrapper.get(`[data-testid="${testId}"]`).trigger('click')
    return { wrapper, hoursNow, click }
}

describe('AdminOpeningHoursEditor', () => {
    it('labels every weekday and the holiday row and marks empty days closed', () => {
        const { wrapper } = mountEditor({ mon: [['09:00', '22:00']] })
        expect(
            wrapper.get('[data-testid="opening-hours-mon"]').text(),
        ).toContain('Monday')
        expect(
            wrapper.get('[data-testid="opening-hours-holiday"]').text(),
        ).toContain('gymInfo.holiday')
        expect(
            wrapper.get('[data-testid="opening-hours-mon"]').text(),
        ).not.toContain('gymInfo.closed')
        expect(
            wrapper.get('[data-testid="opening-hours-sun"]').text(),
        ).toContain('gymInfo.closed')
    })

    it('adds an interval that starts where the last one closed, wrapping past midnight', async () => {
        const { hoursNow, click } = mountEditor({ fri: [['18:00', '23:30']] })
        await click('opening-hours-sat-add')
        expect(hoursNow().sat).toEqual([['09:00', '22:00']])

        await click('opening-hours-fri-add')
        expect(hoursNow().fri).toEqual([
            ['18:00', '23:30'],
            ['23:30', '00:30'],
        ])
        expect(isValidOpeningHours(hoursNow())).toBe(true)
    })

    it('edits one end of an interval and removes intervals', async () => {
        const { wrapper, hoursNow, click } = mountEditor({
            tue: [
                ['07:00', '12:00'],
                ['14:00', '22:00'],
            ],
        })
        await wrapper
            .get('[data-testid="opening-hours-tue-1-closes"]')
            .setValue('01:00')
        expect(hoursNow().tue).toEqual([
            ['07:00', '12:00'],
            ['14:00', '01:00'],
        ])

        await click('opening-hours-tue-0-remove')
        expect(hoursNow().tue).toEqual([['14:00', '01:00']])
    })

    it('copies Monday to the other weekdays only, as independent copies', async () => {
        const { hoursNow, click, wrapper } = mountEditor({
            mon: [['10:00', '23:00']],
            sat: [['09:00', '20:00']],
            holiday: [['12:00', '18:00']],
        })
        await click('opening-hours-copy-monday')
        const copied = hoursNow()
        for (const day of ['tue', 'wed', 'thu', 'fri'] as const)
            expect(copied[day]).toEqual([['10:00', '23:00']])
        expect(copied.sat).toEqual([['09:00', '20:00']])
        expect(copied.sun).toBeUndefined()
        expect(copied.holiday).toEqual([['12:00', '18:00']])

        await wrapper
            .get('[data-testid="opening-hours-tue-0-opens"]')
            .setValue('11:00')
        expect(hoursNow().mon).toEqual([['10:00', '23:00']])
    })
})
