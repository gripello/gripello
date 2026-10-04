import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import GradeConversionDialog from '~/components/GradeConversionDialog.vue'
import { DEFAULT_GYM_BANDS } from '#shared/utils/gradeReference'
import { readableTextOn } from '~/utils/color'

vi.stubGlobal('useCurrentGymId', () => ref('gym1'))
vi.stubGlobal('useGymBands', () => ({
    bands: ref(DEFAULT_GYM_BANDS),
    bandName: (band: { key: string }) => band.key,
}))

describe('GradeConversionDialog', () => {
    it('links the PDF download to the current gym', () => {
        const wrapper = mount(GradeConversionDialog, {
            global: {
                mocks: { $t: (key: string) => key, readableTextOn },
                stubs: {
                    LayoutDialogShell: {
                        template: '<div><slot /><slot name="actions" /></div>',
                    },
                    LayoutSectionHeader: true,
                    UBadge: true,
                    UButton: {
                        props: ['to'],
                        template: '<a :href="to"><slot /></a>',
                    },
                },
            },
        })

        expect(
            wrapper
                .find('[data-testid="grade-conversion-pdf"]')
                .attributes('href'),
        ).toBe('/api/ui/grade-scale?gym=gym1')
    })
})
