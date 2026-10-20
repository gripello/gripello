import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import GradeConversionDialog from '~/components/grade/ConversionDialog.vue'
import { DEFAULT_GYM_BANDS } from '#shared/utils/gradeReference'
import { readableTextOn } from '~/utils/color'

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
                    LayoutSectionHeader: true,
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
            '/api/ui/grade-scale?gym=gym1',
            expect.stringMatching(/\.pdf$/),
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
                LayoutSectionHeader: true,
                UButton: true,
            },
        },
    })
    const top = (testId: string) =>
        parseFloat(
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

    it('offers the PDF in the header, not in a footer', () => {
        expect(
            wrapper.find('[data-testid="grade-conversion-pdf"]').exists(),
        ).toBe(true)
    })
})
