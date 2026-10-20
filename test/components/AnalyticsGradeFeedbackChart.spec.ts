import { mount } from '@vue/test-utils'
import GradeFeedbackChart from '~/components/analytics/GradeFeedbackChart.vue'
import type { FeedbackRoute } from '#shared/utils/analytics'

vi.stubGlobal('useGymPath', () => (path: string) => path)
vi.stubGlobal('useChartTheme', () => ({
    colors: ref({ labelColor: '#000', gridColor: '#eee', textColor: '#000' }),
    palette: ref({ negative: 'red', neutral: 'grey', positive: 'green' }),
}))

const route = (gradeSystem: string) =>
    ({
        id: gradeSystem,
        name: gradeSystem,
        grade: '6a',
        gradeSystem,
        setGrade: 14,
        votedGrade: 15,
        votedGradeLabel: '6a+',
        deviation: 1,
        votes: 3,
    }) as unknown as FeedbackRoute

function axisLabel(routes: FeedbackRoute[]) {
    let option: { yAxis: { axisLabel: { formatter: (v: number) => string } } }
    mount(GradeFeedbackChart, {
        props: { routes },
        global: {
            stubs: {
                AnalyticsBaseEchart: {
                    props: ['option'],
                    setup(props: { option: typeof option }) {
                        option = props.option
                        return () => null
                    },
                },
                AnalyticsChartLegend: true,
            },
        },
    })
    return option!.yAxis.axisLabel.formatter(14)
}

describe('GradeFeedbackChart', () => {
    it('names the axis grades when every route shares one system', () => {
        expect(axisLabel([route('french'), route('french')])).not.toBe('14')
    })

    it('keeps plain numbers when the routes mix grade systems', () => {
        expect(axisLabel([route('french'), route('yds')])).toBe('14')
    })
})
