import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RouteReviewsSection from '~/components/route/ReviewsSection.vue'
import { deleteRating } from '~/api/ratings'
import type { ReviewDisplay } from '~/utils/routeReviews'

vi.mock('~/api/ratings', () => ({ deleteRating: vi.fn() }))

const notifyError = vi.fn()

beforeEach(() => {
    vi.mocked(deleteRating)
        .mockReset()
        .mockResolvedValue(undefined as never)
    notifyError.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useNotification', () => ({ error: notifyError }))
})

const review = (id: string, mine: boolean): ReviewDisplay => ({
    id,
    rating: 4,
    difficultyLabel: '6a',
    comment: 'nice',
    created: '',
    userName: 'Alex',
    userAvatar: null,
    mine,
})

function mountSection(reviews: ReviewDisplay[], targetCommentId = '') {
    return mount(RouteReviewsSection, {
        props: { reviews, targetCommentId },
        global: {
            stubs: {
                CommentsCard: {
                    props: ['comment'],
                    template:
                        '<article :data-id="comment.id"><slot name="actions" /></article>',
                },
                UButton: {
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')" />',
                },
                UBadge: {
                    template: '<span data-testid="count"><slot /></span>',
                },
                LayoutEmptyState: {
                    props: ['title'],
                    template: '<p data-testid="empty">{{ title }}</p>',
                },
                ConfirmDialog: {
                    props: ['modelValue'],
                    emits: ['confirm', 'update:modelValue'],
                    template: `<button v-if="modelValue" data-testid="confirm"
                        @click="$emit('confirm')" />`,
                },
                ReportsFormDialog: {
                    props: ['contentId', 'contentType'],
                    template:
                        '<p data-testid="report">{{ contentType }}:{{ contentId }}</p>',
                },
            },
        },
    })
}

describe('RouteReviewsSection', () => {
    it('invites the first review when there are none', () => {
        const wrapper = mountSection([])
        expect(wrapper.get('[data-testid="empty"]').text()).toBe(
            'ratings.no_reviews_yet',
        )
        expect(wrapper.find('[data-testid="count"]').exists()).toBe(false)
    })

    it('offers delete on your own review and report on the others', async () => {
        const wrapper = mountSection(
            [review('own', true), review('other', false)],
            'other',
        )
        expect(wrapper.get('[data-testid="count"]').text()).toBe('2')
        const [own, other] = wrapper.findAll('article')
        expect(own!.find('[data-testid="comment-card-delete"]').exists()).toBe(
            true,
        )
        expect(own!.find('[data-testid="comment-card-report"]').exists()).toBe(
            false,
        )
        expect(other!.classes()).toContain('comment-card--target')

        await other!.get('[data-testid="comment-card-report"]').trigger('click')
        expect(wrapper.get('[data-testid="report"]').text()).toBe(
            'rating:other',
        )
    })

    it('deletes your review only after confirming', async () => {
        const wrapper = mountSection([review('own', true)])
        await wrapper
            .get('[data-testid="comment-card-delete"]')
            .trigger('click')
        expect(deleteRating).not.toHaveBeenCalled()
        await wrapper.get('[data-testid="confirm"]').trigger('click')
        await flushPromises()
        expect(deleteRating).toHaveBeenCalledWith('own')
        expect(wrapper.emitted('deleted')).toEqual([['own']])
        expect(wrapper.find('[data-testid="confirm"]').exists()).toBe(false)
    })

    it('keeps the review and says so when deleting fails', async () => {
        vi.mocked(deleteRating).mockRejectedValue(new Error('down'))
        const wrapper = mountSection([review('own', true)])
        await wrapper
            .get('[data-testid="comment-card-delete"]')
            .trigger('click')
        await wrapper.get('[data-testid="confirm"]').trigger('click')
        await flushPromises()
        expect(wrapper.emitted('deleted')).toBeUndefined()
        expect(notifyError).toHaveBeenCalledWith('notifications.error.generic')
    })
})
