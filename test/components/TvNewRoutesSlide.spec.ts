import { mount } from '@vue/test-utils'
import NewRoutesSlide from '~/components/tv/NewRoutesSlide.vue'

const route = (id: string, screw_date: string) => ({
    id,
    name: id,
    screw_date,
    wall: 'w1',
})

describe('TvNewRoutesSlide', () => {
    it('labels routes set today and shows the age of older ones', () => {
        const wrapper = mount(NewRoutesSlide, {
            props: {
                routes: [
                    route('today', '2026-10-14 00:00:00.000Z'),
                    route('older', '2026-10-11 00:00:00.000Z'),
                ],
                wallNames: new Map([['w1', 'Cave']]),
                now: new Date('2026-10-14T18:00:00'),
            },
            global: {
                stubs: {
                    GradeLabel: true,
                    UBadge: {
                        props: ['label'],
                        template: '<b>{{ label }}</b>',
                    },
                },
            },
        })

        const ages = wrapper.findAll('[data-testid="tv-route-age"]')
        expect(ages.map((age) => age.text())).toEqual([
            'tv.newToday',
            'time.daysAgo',
        ])
        expect(wrapper.text()).toContain('Cave')
    })
})
