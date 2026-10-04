import { mount } from '@vue/test-utils'
import GradeLabel from '~/components/GradeLabel.vue'
import {
    DEFAULT_GYM_BANDS,
    gymBandsFrom,
    type GymBand,
} from '#shared/utils/gradeReference'

let bands: GymBand[] = DEFAULT_GYM_BANDS

const isUnexpectedSystem = vi.fn(
    (source: { grade_system?: string | null }) => source.grade_system === 'yds',
)

function createWrapper(props: Record<string, unknown>) {
    return mount(GradeLabel, {
        props,
        global: { mocks: { $t: (key: string) => key } },
    })
}

describe('GradeLabel', () => {
    beforeEach(() => {
        isUnexpectedSystem.mockClear()
        vi.stubGlobal('useGradeSystems', () => ({ isUnexpectedSystem }))
        bands = DEFAULT_GYM_BANDS
        vi.stubGlobal('useGymBands', () => ({
            bands: computed(() => bands),
            bandName: (band: GymBand) =>
                band.name ?? `gradeConversion.bands.${band.key}`,
        }))
    })

    it('renders the grade without a system hint for the expected system', () => {
        const wrapper = createWrapper({
            source: { grade: '6a+', grade_system: 'french' },
        })

        expect(wrapper.text()).toBe('6a+')
        expect(wrapper.find('.grade-label__system').exists()).toBe(false)
    })

    it('shows the difficulty band only for boulders', () => {
        const boulder = createWrapper({
            source: { grade: '6C', grade_system: 'font' },
        })
        const route = createWrapper({
            source: { grade: '6a+', grade_system: 'french' },
        })

        expect(
            boulder.find('[data-testid="grade-label-band"]').attributes(),
        ).toMatchObject({
            'data-band': 'red',
            title: 'gradeConversion.bands.red',
        })
        expect(route.find('[data-testid="grade-label-band"]').exists()).toBe(
            false,
        )
    })

    it('uses the gym colours', () => {
        bands = gymBandsFrom([
            { name: 'Mint', color: '#3eb489', to: '7A' },
            { name: 'Pink', color: '#ff69b4', to: '' },
        ])
        const band = createWrapper({
            source: { grade: '6C', grade_system: 'font' },
        }).find('[data-testid="grade-label-band"]')

        expect(band.attributes('title')).toBe('Mint')
        expect(band.attributes('style')).toContain('#3eb489')
    })

    it('adds the short system label for an unexpected system', () => {
        const wrapper = createWrapper({
            source: { grade: '5.10a', grade_system: 'yds' },
        })

        expect(wrapper.find('.grade-label__system').text()).toBe(
            'gradeSystemsShort.yds',
        )
    })

    it('uses an explicit showSystem without asking the composable', () => {
        const wrapper = createWrapper({
            source: { grade: '6a+', grade_system: 'french' },
            showSystem: true,
        })

        expect(wrapper.find('.grade-label__system').text()).toBe(
            'gradeSystemsShort.french',
        )
        expect(isUnexpectedSystem).not.toHaveBeenCalled()
    })

    it('hides the hint when showSystem is false', () => {
        const wrapper = createWrapper({
            source: { grade: '5.10a', grade_system: 'yds' },
            showSystem: false,
        })

        expect(wrapper.find('.grade-label__system').exists()).toBe(false)
    })

    it('renders nothing visible for a missing grade', () => {
        const wrapper = createWrapper({ source: null })

        expect(wrapper.text()).toBe('')
    })
})
