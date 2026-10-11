import { mount } from '@vue/test-utils'
import { computed, ref, watch } from 'vue'
import ReviewsDialog from '~/components/route/ReviewsDialog.vue'

const execute = vi.fn()
const status = ref('idle')

beforeEach(() => {
    execute.mockReset()
    status.value = 'idle'
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useNotification', () => ({ error: vi.fn() }))
    vi.stubGlobal('useAsyncData', () => ({
        data: ref([]),
        status,
        execute,
    }))
})

function createWrapper(modelValue: boolean) {
    return mount(ReviewsDialog, {
        props: { routeId: 'r1', modelValue },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: { template: '<div><slot /></div>' },
                LayoutLoadingState: true,
                LayoutEmptyState: true,
                ReportsFormDialog: true,
            },
        },
    })
}

describe('RouteReviewsDialog', () => {
    it('loads the reviews when it opens', () => {
        createWrapper(true)
        expect(execute).toHaveBeenCalledTimes(1)
    })

    it('does not reload reviews it already has', async () => {
        status.value = 'success'
        const wrapper = createWrapper(false)
        await wrapper.setProps({ modelValue: true })
        expect(execute).not.toHaveBeenCalled()
    })
})
