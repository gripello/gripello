import { mount } from '@vue/test-utils'
import GradeSpread from '~/components/overview/GradeSpread.vue'

describe('OverviewGradeSpread', () => {
    const bars = [
        { grade: '5', count: 2 },
        { grade: '5+', count: 0 },
        { grade: '6-', count: 3 },
    ]

    it('labels every bar with grade and count, zero included, without tab stops', () => {
        const wrapper = mount(GradeSpread, { props: { title: 'Routes', bars } })
        const items = wrapper.findAll('[data-testid="overview-grade-bar"]')
        expect(items.map((item) => item.attributes('aria-label'))).toEqual([
            '5: 2',
            '5+: 0',
            '6-: 3',
        ])
        expect(
            items.every((item) => item.attributes('tabindex') === undefined),
        ).toBe(true)
        expect(items[1]!.find('.grade-spread__count').text()).toBe('0')
    })

    it('marks every second bar as a minor label for narrow charts', () => {
        const wrapper = mount(GradeSpread, { props: { title: 'Routes', bars } })
        const minor = wrapper
            .findAll('[data-testid="overview-grade-bar"]')
            .map((item) => item.classes('grade-spread__bar--minor'))
        expect(minor).toEqual([false, true, false])
    })
})
