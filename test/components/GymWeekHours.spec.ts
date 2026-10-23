import { mount } from '@vue/test-utils'
import WeekHours from '~/components/gym/WeekHours.vue'

function createWrapper(props: Record<string, unknown>) {
    return mount(WeekHours, {
        props,
        global: {
            mocks: {
                $t: (key: string) => key,
                weekdayName: (day: string) => day,
            },
        },
    })
}

describe('GymWeekHours', () => {
    beforeEach(() => {
        vi.stubGlobal('useMountedNow', () => ref(null))
    })

    it('draws open days on the 0–24 track and marks today', () => {
        const wrapper = createWrapper({
            hours: {
                tue: [
                    ['06:00', '12:00'],
                    ['18:00', '22:00'],
                ],
            },
            today: 'tue',
        })

        const tuesday = wrapper.get('[data-testid="gym-hours-day-tue"]')
        expect(tuesday.classes()).toContain('week-hours__day--today')
        const segments = tuesday.findAll('.week-hours__segment')
        expect(segments.map((s) => s.attributes('style'))).toEqual([
            'left: 25%; width: 25%;',
            'left: 75%; width: 16.666666666666664%;',
        ])
        expect(tuesday.text()).toContain('06:00–12:00, 18:00–22:00')

        const monday = wrapper.get('[data-testid="gym-hours-day-mon"]')
        expect(monday.findAll('.week-hours__segment')).toHaveLength(0)
        expect(monday.text()).toContain('gymInfo.closed')
        expect(monday.classes()).toContain('max-sm:hidden')
    })

    it('lists public holidays only when the gym set hours for them', () => {
        expect(
            createWrapper({ hours: { mon: [['08:00', '20:00']] } })
                .find('[data-testid="gym-hours-day-holiday"]')
                .exists(),
        ).toBe(false)
        expect(
            createWrapper({ hours: { holiday: [['10:00', '18:00']] } })
                .get('[data-testid="gym-hours-day-holiday"]')
                .text(),
        ).toContain('10:00–18:00')
    })

    it('shows a day open only after midnight with its spill-over hours', () => {
        const wrapper = createWrapper({
            hours: { fri: [['18:00', '02:00']] },
            today: 'mon',
        })

        const saturday = wrapper.get('[data-testid="gym-hours-day-sat"]')
        expect(saturday.findAll('.week-hours__segment')).toHaveLength(1)
        expect(saturday.text()).toContain('00:00–02:00')
        expect(saturday.text()).not.toContain('gymInfo.closed')
        expect(saturday.classes()).not.toContain('max-sm:hidden')
    })
})
