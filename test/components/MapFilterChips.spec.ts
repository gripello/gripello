import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import MapFilterChips from '~/components/map/FilterChips.vue'

const close = vi.fn()

beforeEach(() => {
    close.mockReset()
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
})

function mountChips(props: Record<string, unknown> = {}) {
    return mount(MapFilterChips, {
        props: {
            grades: [
                { title: '6a', value: '6a' },
                { title: '7a', value: '7a' },
            ],
            colors: [],
            gradeLabel: 'Grade',
            activeCount: 0,
            ...props,
        },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UButton: {
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
                },
                UPopover: {
                    setup: () => ({ close }),
                    template:
                        '<div><slot /><slot name="content" :close="close" /></div>',
                },
                MapColorFilter: true,
            },
        },
    })
}

describe('MapFilterChips', () => {
    it('toggles the route type and clears it on a second tap', async () => {
        const wrapper = mountChips({ typeFilter: true })
        const boulders = wrapper.get('[data-testid="map-type-Boulder"]')
        await boulders.trigger('click')
        expect(wrapper.emitted('update:type')?.at(-1)).toEqual(['Boulder'])
        await wrapper.setProps({ type: 'Boulder' })
        expect(boulders.attributes('aria-pressed')).toBe('true')
        await boulders.trigger('click')
        expect(wrapper.emitted('update:type')?.at(-1)).toEqual([''])
    })

    it('offers no type chips unless asked to', () => {
        expect(
            mountChips().find('[data-testid="map-type-Boulder"]').exists(),
        ).toBe(false)
    })

    it('picks a grade, closes the menu and shows the grade on the chip', async () => {
        const wrapper = mountChips()
        expect(wrapper.get('[data-testid="map-filter-grade"]').text()).toBe(
            'Grade',
        )
        await wrapper
            .findAll('[data-testid="map-grade-option"]')[1]!
            .trigger('click')
        expect(wrapper.emitted('update:grade')?.at(-1)).toEqual(['7a'])
        expect(close).toHaveBeenCalledOnce()

        await wrapper.setProps({ grade: '7a' })
        expect(wrapper.get('[data-testid="map-filter-grade"]').text()).toBe(
            '7a',
        )
        await wrapper.get('[role="option"]').trigger('click')
        expect(wrapper.emitted('update:grade')?.at(-1)).toEqual([null])
    })

    it('hides empty pickers and shows clear only with active filters', async () => {
        const wrapper = mountChips({ grades: [] })
        expect(wrapper.find('[data-testid="map-filter-grade"]').exists()).toBe(
            false,
        )
        expect(
            wrapper.find('[data-testid="map-filter-color-chip"]').exists(),
        ).toBe(false)
        expect(wrapper.find('[data-testid="map-filter-clear"]').exists()).toBe(
            false,
        )
        await wrapper.setProps({ activeCount: 2, colors: ['#ff0000'] })
        expect(
            wrapper.find('[data-testid="map-filter-color-chip"]').exists(),
        ).toBe(true)
        await wrapper.get('[data-testid="map-filter-clear"]').trigger('click')
        expect(wrapper.emitted('clear')).toHaveLength(1)
    })
})
