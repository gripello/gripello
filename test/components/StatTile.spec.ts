import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import StatTile from '~/components/layout/StatTile.vue'

vi.stubGlobal('computed', computed)

const stubs = { UIcon: { props: ['name'], template: '<i />' } }

describe('LayoutStatTile', () => {
    it('maps colour names to theme text classes', () => {
        const tile = mount(StatTile, {
            props: {
                label: 'Flashes',
                value: 3,
                icon: 'i-lucide-zap',
                iconColor: 'warning',
                color: 'error',
            },
            global: { stubs },
        })
        expect(tile.find('i').classes()).toContain('text-warning')
        expect(tile.get('[data-testid="stat-tile-value"]').classes()).toContain(
            'text-error',
        )
        expect(tile.text()).toContain('Flashes')
    })

    it('keeps the inherited text colour and takes a custom value test id', () => {
        const tile = mount(StatTile, {
            props: { label: 'Bib', value: 7, valueTestId: 'my-bib' },
            global: { stubs },
        })
        const value = tile.get('[data-testid="my-bib"]')
        expect(value.text()).toBe('7')
        expect(value.classes().some((name) => name.startsWith('text-e'))).toBe(
            false,
        )
    })
})
