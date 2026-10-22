import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import GradeConversionDialog from '~/components/grade/ConversionDialog.vue'
import { DEFAULT_GYM_BANDS } from '#shared/utils/gradeReference'
import { readableTextOn } from '~/utils/color'

const SegmentedControl = {
    props: ['modelValue', 'items', 'testId'],
    emits: ['update:modelValue'],
    template:
        '<div :data-testid="testId" :data-value="modelValue"><button v-for="item in items" :key="item.value" :data-testid="`${testId}-${item.value}`" @click="$emit(\'update:modelValue\', item.value)">{{ item.label }}</button></div>',
}

const saveDownload = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('~/utils/download', () => ({ saveDownload }))

vi.stubGlobal('useAsyncAction', () => ({
    pending: ref(false),
    run: (action: () => unknown) => action(),
}))
vi.stubGlobal('useCurrentGymId', () => ref('gym1'))
vi.stubGlobal('useGymBands', () => ({
    bands: ref(DEFAULT_GYM_BANDS),
    bandName: (band: { key: string }) => band.key,
}))

describe('GradeConversionDialog', () => {
    it("downloads the current gym's PDF through saveDownload", async () => {
        const wrapper = mount(GradeConversionDialog, {
            global: {
                mocks: { $t: (key: string) => key, readableTextOn },
                stubs: {
                    LayoutDialogShell: {
                        template:
                            '<div><slot name="header-actions" /><slot /></div>',
                    },
                    SegmentedControl,
                    UBadge: true,
                    UButton: {
                        template:
                            '<button @click="$attrs.onClick?.()"><slot /></button>',
                    },
                },
            },
        })

        await wrapper
            .find('[data-testid="grade-conversion-pdf"]')
            .trigger('click')
        expect(saveDownload).toHaveBeenCalledWith(
            '/api/ui/grade-scale?gym=gym1&kind=boulders',
            expect.stringMatching(/gradeConversion\.boulders\.pdf$/),
        )
    })
})

describe('GradeConversionDialog ladders', () => {
    const wrapper = mount(GradeConversionDialog, {
        props: { source: { grade_system: 'french', grade: '7a' } },
        global: {
            mocks: { $t: (key: string) => key, readableTextOn },
            stubs: {
                LayoutDialogShell: {
                    template:
                        '<div><slot name="header-actions" /><slot /></div>',
                },
                SegmentedControl,
                UButton: true,
            },
        },
    })
    const remOf = (value: string) => Number(/([\d.]+)rem/.exec(value)?.[1])
    const top = (testId: string) =>
        remOf(
            (
                wrapper
                    .find('[data-testid="grade-conversion-routes"]')
                    .find(`[data-testid="${testId}"]`).element as HTMLElement
            ).style.top,
        )

    it('places each scale on the shared IRCRA axis, not row by row', () => {
        const routes = wrapper.find('[data-testid="grade-conversion-routes"]')
        expect(
            routes.find('[data-testid="grade-conversion-uiaa-11-"]').exists(),
        ).toBe(true)
        expect(top('grade-conversion-uiaa-11-')).toBeGreaterThan(
            top('grade-conversion-french-8b'),
        )
        expect(top('grade-conversion-uiaa-7')).not.toBe(
            top('grade-conversion-french-6b'),
        )
    })

    it("opens on the source grade's ladder", () => {
        expect(
            wrapper
                .find('[data-testid="grade-conversion-tabs"]')
                .attributes('data-value'),
        ).toBe('routes')
    })

    it('marks only the tapped cell and lays the row band under it', async () => {
        await wrapper
            .find('[data-testid="grade-conversion-yds-5.11a"]')
            .trigger('click')
        const highlighted = wrapper.findAll(
            '.grade-conversion__label--highlight',
        )
        expect(highlighted).toHaveLength(1)
        expect(highlighted[0]!.attributes('data-testid')).toBe(
            'grade-conversion-yds-5.11a',
        )
        expect(highlighted[0]!.attributes('aria-current')).toBe('true')
        expect(
            wrapper
                .findAll('[aria-current]')
                .map((cell) => cell.attributes('data-testid')),
        ).toEqual(['grade-conversion-yds-5.11a'])
        const routes = wrapper.find('[data-testid="grade-conversion-routes"]')
        const row = routes.find('[data-testid="grade-conversion-row"]')
            .element as HTMLElement
        expect(remOf(row.style.top)).toBeCloseTo(
            top('grade-conversion-yds-5.11a'),
        )
        await wrapper.setProps({
            source: { grade_system: 'french', grade: '6b' },
        })
        await wrapper.setProps({
            source: { grade_system: 'french', grade: '7a' },
        })
    })

    it('selects a gym band as a single cell', async () => {
        await wrapper
            .find('[data-testid="grade-conversion-band-blue"]')
            .trigger('click')
        expect(
            wrapper.findAll('.grade-conversion__label--highlight'),
        ).toHaveLength(1)
        await wrapper.setProps({
            source: { grade_system: 'french', grade: '6b' },
        })
        await wrapper.setProps({
            source: { grade_system: 'french', grade: '7a' },
        })
    })

    it('gives the gym colour column a short phone title', () => {
        expect(
            wrapper.find('[data-testid="grade-conversion-boulders"]').text(),
        ).toContain('gradeConversion.gymBandShort')
    })

    it('labels the gym bands with their font range', () => {
        const band = (key: string) =>
            wrapper.find(`[data-testid="grade-conversion-band-${key}"]`).text()
        expect(band('yellow')).toContain('gradeConversion.upTo')
        expect(band('blue')).toContain('6A – 6B')
        expect(band('black')).toContain('gradeConversion.andUp')
    })

    it('switches to the boulder ladder for a boulder grade', async () => {
        await wrapper.setProps({
            source: { grade_system: 'font', grade: '6B' },
        })
        expect(
            wrapper
                .find('[data-testid="grade-conversion-tabs"]')
                .attributes('data-value'),
        ).toBe('boulders')
        expect(
            wrapper.find('[data-testid="grade-conversion-font-6B"]').classes(),
        ).toContain('grade-conversion__label--highlight')
        await wrapper.setProps({
            source: { grade_system: 'french', grade: '7a' },
        })
    })

    it('highlights the source grade and shows no notes', () => {
        expect(
            wrapper
                .find('[data-testid="grade-conversion-french-7a"]')
                .classes(),
        ).toContain('grade-conversion__label--highlight')
        expect(wrapper.find('ul').exists()).toBe(false)
    })

    it('keeps the UIAA reference beside the boulders out of the route ids', async () => {
        const boulders = wrapper.find(
            '[data-testid="grade-conversion-boulders"]',
        )
        expect(
            boulders.find('[data-testid="grade-conversion-uiaa-8"]').exists(),
        ).toBe(false)
        expect(
            boulders
                .find('[data-testid="grade-conversion-reference-uiaa-8"]')
                .exists(),
        ).toBe(true)
        await wrapper.setProps({ source: { grade_system: 'uiaa', grade: '8' } })
        expect(
            wrapper.findAll('.grade-conversion__label--highlight'),
        ).toHaveLength(1)
        await wrapper.setProps({
            source: { grade_system: 'french', grade: '7a' },
        })
    })

    it('downloads the PDF of the open ladder', async () => {
        saveDownload.mockClear()
        await wrapper
            .find('[data-testid="grade-conversion-pdf"]')
            .trigger('click')
        expect(saveDownload).toHaveBeenCalledWith(
            '/api/ui/grade-scale?gym=gym1&kind=routes',
            expect.stringMatching(/gradeConversion\.routes\.pdf$/),
        )
    })

    it('offers the PDF in the header, not in a footer', () => {
        expect(
            wrapper.find('[data-testid="grade-conversion-pdf"]').exists(),
        ).toBe(true)
    })
})
