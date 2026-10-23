import { mount } from '@vue/test-utils'
import { computed, ref, watch } from 'vue'
import ReviewsDialog from '~/components/route/ReviewsDialog.vue'

const execute = vi.fn()
const status = ref('idle')
const ratings = ref<unknown[]>([])
const blocked = new Set<string>()

beforeEach(() => {
    execute.mockReset()
    status.value = 'idle'
    ratings.value = []
    blocked.clear()
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useBlocks', () => ({
        isBlocked: (id?: string) => !!id && blocked.has(id),
    }))
    vi.stubGlobal('useAsyncData', () => ({
        data: ratings,
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
                LayoutLoadError: {
                    template:
                        '<button data-testid="load-error-retry" @click="$emit(\'retry\')" />',
                },
                CommentsCard: {
                    props: ['comment'],
                    template: '<p class="review">{{ comment.userName }}</p>',
                },
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

    it('hides reviews by blocked climbers', () => {
        status.value = 'success'
        blocked.add('blocked-user')
        ratings.value = [
            { id: 'a', author: { id: 'blocked-user', name: 'Blocked' } },
            { id: 'b', author: { id: 'friend', name: 'Friend' } },
        ]
        const reviews = createWrapper(true).findAll('.review')
        expect(reviews.map((review) => review.text())).toEqual(['Friend'])
    })

    it('offers a retry when the reviews failed to load', async () => {
        status.value = 'error'
        const wrapper = createWrapper(false)
        await wrapper.get('[data-testid="load-error-retry"]').trigger('click')
        expect(execute).toHaveBeenCalledTimes(1)
    })
})
