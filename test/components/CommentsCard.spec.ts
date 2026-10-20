import { mount } from '@vue/test-utils'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import CommentsCard from '~/components/comments/Card.vue'
import type { CommentCardItem } from '~/components/comments/Card.vue'

beforeEach(() => {
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useI18n', () => ({
        t: (key: string) => key,
        locale: ref('en'),
    }))
    vi.stubGlobal('useGymPath', () => (path: string) => path)
})

function card(comment: Partial<CommentCardItem>) {
    return mount(CommentsCard, {
        props: {
            comment: {
                id: 'c1',
                userName: 'Nina',
                created: '2026-05-13T10:00:00Z',
                ...comment,
            },
        },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                ClimberAvatar: true,
                NuxtLink: { template: '<a><slot /></a>' },
                UTooltip: { template: '<span><slot /></span>' },
                UIcon: true,
                UButton: true,
                UCheckbox: true,
            },
        },
    })
}

describe('CommentsCard', () => {
    it('shows the felt grade in the meta line under the name', () => {
        const wrapper = card({ difficultyLabel: '6B', comment: 'gut' })
        const meta = wrapper.get('[data-testid="comment-card-meta"]')
        expect(meta.get('[data-testid="comment-card-perceived"]').text()).toBe(
            'ratings.perceived 6B',
        )
    })

    it('keeps the comment in the text column next to the avatar', () => {
        for (const difficultyLabel of ['6B', null]) {
            const wrapper = card({ difficultyLabel, comment: 'gut' })
            const column = wrapper.get('.comment-card__main')
            expect(
                column.find('[data-testid="comment-card-author"]').exists(),
            ).toBe(true)
            expect(
                column.find('[data-testid="comment-card-comment"]').exists(),
            ).toBe(true)
        }
    })

    it('renders no empty pill row without a location or route', () => {
        expect(
            card({ comment: 'gut' }).find('.list-card__pills').exists(),
        ).toBe(false)
    })
})
