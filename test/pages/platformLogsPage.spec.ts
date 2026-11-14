import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, reactive, useTemplateRef } from 'vue'
import type { LocationQuery } from 'vue-router'
import LogsPage from '~/pages/platform/logs.vue'
import { listServerLogs } from '~/api/platform'
import { useAsyncAction } from '~/composables/useAsyncAction'

vi.mock('~/api/platform', () => ({
    listServerLogs: vi.fn(),
    setLogLevel: vi.fn(),
}))

const line = (time: string, attrs?: Record<string, unknown>) => ({
    time,
    replica: 'app-1',
    level: 'INFO',
    message: `at ${time}`,
    attrs,
})

function mountPage(query: LocationQuery) {
    const route = reactive({ query })
    const replace = vi.fn(async (to: { query: LocationQuery }) => {
        route.query = to.query
    })
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('useTemplateRef', useTemplateRef)
    vi.stubGlobal('definePageMeta', () => {})
    vi.stubGlobal('useHead', () => {})
    vi.stubGlobal('defineShortcuts', () => {})
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace }))
    vi.stubGlobal('useNotification', () => ({
        success: vi.fn(),
        error: vi.fn(),
        notify: vi.fn(),
    }))
    vi.stubGlobal('useAsyncAction', useAsyncAction)
    const wrapper = mount(
        defineComponent({
            components: { LogsPage },
            template: '<Suspense><LogsPage /></Suspense>',
        }),
        {
            global: {
                stubs: {
                    LayoutPageHeader: {
                        template: '<header><slot name="actions" /></header>',
                    },
                    LayoutPanel: { template: '<section><slot /></section>' },
                    LayoutLoadingState: true,
                    PlatformIssueList: true,
                    SegmentedControl: true,
                    URadioGroup: true,
                    UBadge: true,
                    UKbd: true,
                    UEmpty: true,
                    UButton: {
                        template: '<button type="button"><slot /></button>',
                    },
                    UInput: {
                        props: ['modelValue'],
                        emits: ['update:modelValue'],
                        template:
                            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
                    },
                },
            },
        },
    )
    return { wrapper, replace, route }
}

describe('platform logs page', () => {
    it('loads with the URL filters, pages back and filters by a clicked value', async () => {
        vi.mocked(listServerLogs)
            .mockResolvedValueOnce({
                level: 'info',
                replicas: [],
                items: [
                    line('2026-11-02T10:02:00.000Z', { req: 'r1', user: 'u9' }),
                    line('2026-11-02T10:01:00.000Z'),
                ],
                next: '1793613660000000-41',
            })
            .mockResolvedValueOnce({
                level: 'info',
                replicas: [],
                items: [line('2026-11-02T10:00:00.000Z')],
                next: null,
            })
        const { wrapper, replace } = mountPage({ req: 'r1', issue: 'fp' })
        await flushPromises()
        const filters = { req: 'r1', user: '', route: '', q: '' }
        expect(listServerLogs).toHaveBeenLastCalledWith('debug', filters)
        const rows = () =>
            wrapper
                .get('[data-testid="platform-logs-list"]')
                .findAll(':scope > li')
        expect(rows()).toHaveLength(2)

        await wrapper
            .get('[data-testid="platform-logs-older"]')
            .trigger('click')
        await flushPromises()
        expect(listServerLogs).toHaveBeenLastCalledWith('debug', {
            ...filters,
            cursor: '1793613660000000-41',
        })
        expect(rows()).toHaveLength(3)
        expect(
            wrapper.find('[data-testid="platform-logs-older"]').exists(),
        ).toBe(false)
        expect(wrapper.get('[data-testid="platform-logs-live"]').text()).toBe(
            'platform.logs.paused',
        )

        await rows()[0]!.get('button').trigger('click')
        await wrapper
            .get('[data-testid="platform-logs-by-user"]')
            .trigger('click')
        expect(replace).toHaveBeenLastCalledWith({
            query: { req: 'r1', issue: 'fp', user: 'u9' },
        })

        await wrapper
            .get('[data-testid="platform-logs-route"]')
            .setValue('GET /x')
        expect(replace).toHaveBeenCalledTimes(1)
        await vi.waitFor(() =>
            expect(replace).toHaveBeenLastCalledWith({
                query: { req: 'r1', issue: 'fp', user: 'u9', route: 'GET /x' },
            }),
        )

        await wrapper
            .get('[data-testid="platform-logs-clear-filters"]')
            .trigger('click')
        expect(replace).toHaveBeenLastCalledWith({ query: { issue: 'fp' } })
        wrapper.unmount()
    })

    it('shows filters the URL changed elsewhere and keeps the text being typed', async () => {
        vi.mocked(listServerLogs).mockResolvedValue({
            level: 'info',
            replicas: [],
            items: [],
            next: null,
        })
        const { wrapper, route } = mountPage({ req: 'r1' })
        await flushPromises()
        const input = (key: string) =>
            wrapper.get<HTMLInputElement>(
                `[data-testid="platform-logs-${key}"]`,
            )

        route.query = { req: 'r2', route: 'GET /x' }
        await flushPromises()
        expect(input('req').element.value).toBe('r2')
        expect(input('route').element.value).toBe('GET /x')

        await input('user').setValue('u1 ')
        await vi.waitFor(() => expect(route.query.user).toBe('u1'))
        await flushPromises()
        expect(input('user').element.value).toBe('u1 ')
        wrapper.unmount()
    })

    it('truncates a long replica name instead of widening the row', async () => {
        const replica = 'gripello-gripello-pr-783-7-kqzs2-d4w82-dwlbm'
        vi.mocked(listServerLogs).mockResolvedValue({
            level: 'info',
            replicas: [],
            items: [{ ...line('2026-11-14T09:00:00.000Z'), replica }],
            next: null,
        })
        const { wrapper } = mountPage({})
        await flushPromises()
        const cell = wrapper.get('[data-testid="platform-log-replica"]')
        expect(cell.classes()).toEqual(
            expect.arrayContaining(['min-w-0', 'truncate']),
        )
        expect(cell.classes()).not.toContain('shrink-0')
        expect(cell.attributes('title')).toBe(replica)
        wrapper.unmount()
    })
})
