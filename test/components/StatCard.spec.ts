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
