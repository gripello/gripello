import { mount } from '@vue/test-utils'
import { computed, reactive, ref, watch } from 'vue'
import ReviewFormDialog from '~/components/ReviewFormDialog.vue'

vi.mock('~/api/ratings', () => ({
    createRating: vi.fn(),
    updateRating: vi.fn(),
}))

beforeEach(() => {
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useNotification', () => ({ error: vi.fn() }))
    vi.stubGlobal('useCapToken', () => ({ capHeaders: vi.fn() }))
    vi.stubGlobal('useNuxtApp', () => ({ $realtimeCache: {} }))
})

async function openDialog(routeGrade: string | null) {
    const wrapper = mount(ReviewFormDialog, {
        props: {
            modelValue: false,
            routeId: 'r1',
            gradeSystem: 'uiaa',
            routeGrade,
        },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: { template: '<div><slot /></div>' },
                SegmentedControl: {
                    name: 'SegmentedControl',
                    props: ['modelValue', 'items'],
                    template: '<div />',
                },
                USelectMenu: {
                    name: 'USelectMenu',
                    props: ['modelValue', 'items'],
                    template: '<div />',
                },
            },
        },
    })
    await wrapper.setProps({ modelValue: true })
    return wrapper
}

describe('ReviewFormDialog', () => {
    it('offers two grades either side of the route grade, starting on it', async () => {
        const wrapper = await openDialog('5')

        const grades = wrapper.getComponent({ name: 'SegmentedControl' })
        expect(
            grades.props('items').map(({ value }: { value: string }) => value),
        ).toEqual(['4+', '5-', '5', '5+', '6-'])
        expect(grades.props('modelValue')).toBe('5')
    })

    it('keeps the picked grade', async () => {
        const wrapper = await openDialog('5')

        const grades = wrapper.getComponent({ name: 'SegmentedControl' })
        grades.vm.$emit('update:modelValue', '6-')
        await wrapper.vm.$nextTick()

        expect(grades.props('modelValue')).toBe('6-')
    })

    it('falls back to every grade when the route grade is unknown', async () => {
        const wrapper = await openDialog(null)

        expect(
            wrapper.findComponent({ name: 'SegmentedControl' }).exists(),
        ).toBe(false)
        const select = wrapper.getComponent({ name: 'USelectMenu' })
        expect(select.props('items')).toContain('9+')
        expect(select.props('modelValue')).toBeNull()
    })
})
