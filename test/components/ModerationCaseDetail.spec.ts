import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import ModerationCaseDetail from '~/components/moderation/CaseDetail.vue'
import type { ModerationItemRecord } from '~/types/models'

const token = ref<string | null>('tok')

beforeEach(() => {
    token.value = 'tok'
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useI18n', () => ({
        t: (key: string, count?: number) =>
            typeof count === 'number' ? `${key}(${count})` : key,
        locale: ref('en'),
    }))
    vi.stubGlobal('useFileToken', () => ({ token, renew: vi.fn() }))
    vi.stubGlobal('climberFileUrl', () => 'avatar.png')
})

function item(overrides: Partial<ModerationItemRecord> = {}) {
    return {
        id: 'm1',
        gym: 'g1',
        content_type: 'rating',
        content_id: 'c1',
        state: 'open',
        created: '2024-01-01T00:00:00.000Z',
        snapshot: { comment: 'Too soft' },
        context: {
            route: { id: 'r1', name: 'Arete' },
            author: { id: 'u1', name: 'Ann' },
            reports: [
                {
                    id: 'p1',
                    reason: 'spam',
                    status: 'open',
                    notifier_name: 'Bob',
                    created: '2024-01-02T00:00:00.000Z',
                },
                {
                    id: 'p2',
                    reason: 'other',
                    status: 'rejected',
                    notifier_name: 'Cy',
                    explanation: 'Rude',
                    created: '2024-01-03T00:00:00.000Z',
                },
            ],
        },
        ...overrides,
    } as unknown as ModerationItemRecord
}

function mountDetail(
    props: Partial<{
        item: ModerationItemRecord
        actions: string[]
        platform: boolean
    }> = {},
) {
    return mount(ModerationCaseDetail, {
        props: { item: item(), actions: [], ...props } as never,
        global: {
            stubs: {
                RouteSummary: {
                    props: ['route', 'meta'],
                    template: '<span>{{ route.name }} {{ meta }}</span>',
                },
                UButton: {
                    props: ['to'],
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" :data-to="to" @click="$emit(\'click\')"><slot /></button>',
                },
                ClimberAvatar: true,
                UIcon: true,
                UBadge: { template: '<em><slot /></em>' },
                LayoutListGroup: { template: '<ul><slot /></ul>' },
            },
        },
    })
}

describe('ModerationCaseDetail', () => {
    it('renders only the actions the server allows and emits the one clicked', async () => {
        const wrapper = mountDetail({ actions: ['hide', 'approve'] })
        const buttons = wrapper.findAll('footer button')
        expect(
            buttons.map((button) => button.attributes('data-testid')),
        ).toEqual(['moderation-hide', 'moderation-approve'])
        expect(buttons[1]!.text()).toBe('moderation.actions.keep')
        await buttons[0]!.trigger('click')
        expect(wrapper.emitted('act')).toEqual([['hide']])

        expect(mountDetail().find('footer').exists()).toBe(false)
        expect(
            mountDetail({
                item: item({ state: 'pending' }),
                actions: ['approve'],
            })
                .get('[data-testid="moderation-approve"]')
                .text(),
        ).toBe('moderation.actions.publish')
    })

    it('explains what a decision does by the case state and open reports', () => {
        const footer = (overrides: Partial<ModerationItemRecord>) =>
            mountDetail({ item: item(overrides), actions: ['hide'] })
                .get('footer p')
                .text()
        expect(footer({})).toBe('moderation.consequence.reports(1)')
        expect(footer({ state: 'pending' })).toBe(
            'moderation.consequence.pending',
        )
        expect(footer({ state: 'hidden' })).toBe(
            'moderation.consequence.restore',
        )
        expect(footer({ context: { reports: [] } } as never)).toBe(
            'moderation.consequence.author',
        )
    })

    it('links the content in place, except a beta still awaiting approval', () => {
        const link = (overrides: Partial<ModerationItemRecord>) =>
            mountDetail({ item: item(overrides) })
                .element.querySelector(
                    '[data-testid="moderation-context-link"]',
                )
                ?.getAttribute('data-to') ?? undefined
        expect(link({})).toBe('/route?id=r1#comment-c1')
        expect(link({ content_type: 'beta_video' })).toBe(
            '/route?id=r1#beta-c1',
        )
        expect(link({ content_type: 'beta_video', state: 'pending' })).toBe(
            undefined,
        )
        expect(link({ content_type: 'profile' })).toBe('/climber?id=c1')
        expect(link({ content_type: 'route' })).toBe('/route?id=c1')
        expect(link({ content_type: 'competition_entry' })).toBe(undefined)
    })

    it('shows the content, its reports and who hid it', () => {
        const wrapper = mountDetail({
            item: item({
                state: 'hidden',
                hidden_by: 'platform',
                reason: 'Spam',
            }),
        })
        expect(
            wrapper.get('[data-testid="moderation-detail-text"]').text(),
        ).toBe('Too soft')
        expect(
            wrapper.get('[data-testid="moderation-decision-note"]').text(),
        ).toContain('moderation.hiddenByPlatform · Spam')
        expect(
            wrapper.get('[data-testid="moderation-report-p1"]').text(),
        ).not.toContain('reports.status')
        expect(
            wrapper.get('[data-testid="moderation-report-p2"]').text(),
        ).toContain('reports.status.rejected')
        expect(
            wrapper.get('[data-testid="moderation-report-p2"]').text(),
        ).toContain('Rude')
        expect(
            mountDetail()
                .find('[data-testid="moderation-decision-note"]')
                .exists(),
        ).toBe(false)
    })

    it('shows staged files only once their token exists', async () => {
        token.value = null
        const wrapper = mountDetail({
            item: item({
                content_type: 'beta_video',
                state: 'pending',
                files: ['clip.mp4'],
            }),
        })
        expect(wrapper.find('video').exists()).toBe(false)
        token.value = 'tok'
        await wrapper.vm.$nextTick()
        expect(wrapper.get('video').attributes('src')).toContain(
            '/files/moderation_items/m1/clip.mp4?token=tok',
        )
    })

    it('offers author tools only to the platform', async () => {
        expect(
            mountDetail()
                .find('[data-testid="moderation-author-panel"]')
                .exists(),
        ).toBe(false)
        expect(
            mountDetail({
                platform: true,
                item: item({ context: { reports: [] } } as never),
            })
                .find('[data-testid="moderation-author-panel"]')
                .exists(),
        ).toBe(false)

        const wrapper = mountDetail({ platform: true })
        await wrapper
            .get('[data-testid="moderation-author-filter"]')
            .trigger('click')
        await wrapper
            .get('[data-testid="moderation-author-hide"]')
            .trigger('click')
        await wrapper
            .get('[data-testid="moderation-author-suspend"]')
            .trigger('click')
        expect(Object.keys(wrapper.emitted())).toEqual(
            expect.arrayContaining([
                'showAuthor',
                'hideAuthor',
                'suspendAuthor',
            ]),
        )
    })
})
