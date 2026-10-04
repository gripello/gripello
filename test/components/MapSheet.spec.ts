import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { useTemplateRef } from 'vue'
import MapSheet from '~/components/map/Sheet.vue'

vi.stubGlobal('useTemplateRef', useTemplateRef)

describe('MapSheet', () => {
    it('collapses the side panel to its toggle and reopens it', async () => {
        const wrapper = mount(MapSheet, {
            slots: {
                header: '<span data-testid="head">All routes</span>',
                default: '<ul data-testid="list" />',
            },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    UButton: {
                        props: ['ariaLabel'],
                        template:
                            '<button v-bind="$attrs" :aria-label="ariaLabel" />',
                    },
                },
            },
        })
        const toggle = () => wrapper.get('[data-testid="map-sheet-collapse"]')
        expect(wrapper.find('[data-testid="list"]').exists()).toBe(true)

        await toggle().trigger('click')
        expect(wrapper.find('[data-testid="list"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="head"]').exists()).toBe(false)
        expect(toggle().attributes('aria-label')).toBe('map.showList')

        await toggle().trigger('click')
        expect(wrapper.find('[data-testid="list"]').exists()).toBe(true)
    })
})
