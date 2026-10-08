import { mount } from '@vue/test-utils'
import RouteSummary from '~/components/route/Summary.vue'

const route = {
    name: 'Nordwand',
    color: 'red',
    grade: '6a',
    grade_system: 'french',
}

function createWrapper(props: Record<string, unknown> = {}, slots = {}) {
    return mount(RouteSummary, {
        props: { route, ...props },
        slots,
        global: {
            stubs: {
                RouteColorDot: {
                    props: ['size', 'ticked'],
                    template: '<i :data-size="size" :data-ticked="ticked" />',
                },
                GradeLabel: { template: '<b class="grade" />' },
                NuxtLink: {
                    props: ['to'],
                    template: '<a :href="to"><slot /></a>',
                },
            },
        },
    })
}

describe('RouteSummary', () => {
    it('shows dot, name, meta and grade', () => {
        const wrapper = createWrapper({ meta: 'Wall A', ticked: true })

        expect(wrapper.text()).toContain('Nordwand')
        expect(wrapper.text()).toContain('Wall A')
        expect(wrapper.find('.grade').exists()).toBe(true)
        expect(wrapper.find('i').attributes()).toMatchObject({
            'data-size': '28',
            'data-ticked': 'true',
        })
    })

    it('links the name and uses a small dot when asked', () => {
        const wrapper = createWrapper({
            to: '/route?id=1',
            size: 'sm',
            hideGrade: true,
        })

        expect(wrapper.find('a').attributes('href')).toBe('/route?id=1')
        expect(wrapper.find('i').attributes('data-size')).toBe('16')
        expect(wrapper.find('.grade').exists()).toBe(false)
    })

    it('renders markers and a custom meta slot', () => {
        const wrapper = createWrapper(
            {},
            {
                markers: '<span class="marker" />',
                meta: 'custom meta',
            },
        )

        expect(wrapper.find('.marker').exists()).toBe(true)
        expect(wrapper.text()).toContain('custom meta')
    })
})
