import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import StatCard from '~/components/layout/StatCard.vue'

vi.stubGlobal('computed', computed)

describe('LayoutStatCard', () => {
    it('names its meter after the card title', () => {
        const card = mount(StatCard, {
            props: {
                title: 'Active routes',
                value: 40,
                meter: 0.4,
                icon: 'i-lucide-route',
                color: 'primary',
            },
            global: { stubs: { UIcon: true, UBadge: true, USkeleton: true } },
        })
        const meter = card.get('[role="progressbar"]')
        const label = card.get(`#${meter.attributes('aria-labelledby')}`)
        expect(label.text()).toBe('Active routes')
    })
})

describe('LayoutStatCard sparkline and colour', () => {
    const mountCard = (props: Record<string, unknown>) =>
        mount(StatCard, {
            props: { title: 'Rate', value: 0, icon: 'i-lucide-x', ...props },
            global: { stubs: { UIcon: true, UBadge: true, USkeleton: true } },
        })

    it('scales a sparkline of fractions to its own maximum', () => {
        const card = mountCard({ color: 'error', spark: [0, 0.02, 0.01] })
        const points = card.get('polyline').attributes('points')
        expect(points).toContain('50,2')
    })

    it('renders a neutral card in the muted text colour', () => {
        const card = mountCard({ color: 'neutral' })
        expect(card.html()).toContain('var(--ui-text-muted)')
    })
})
