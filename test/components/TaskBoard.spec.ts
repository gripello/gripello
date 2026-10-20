import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref, shallowRef } from 'vue'
import TaskBoard from '~/components/task/Board.vue'
import { useLongPressDrag } from '~/composables/useLongPressDrag'
import { listTasks } from '~/api/tasks'

vi.mock('~/api/tasks', () => ({
    listTasks: vi.fn(async (_gym: string, query: { status: string[] }) => ({
        items: query.status.includes('done')
            ? []
            : [{ id: 'task1', kind: 'defect', status: 'open', priority: 2 }],
    })),
    setTaskStatus: vi.fn(),
}))

describe('TaskBoard', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.stubGlobal('useCurrentGymId', () => ref('gym1'))
        vi.stubGlobal('useAsyncAction', () => ({ run: vi.fn() }))
        vi.stubGlobal('useNotification', () => ({ error: vi.fn() }))
        vi.stubGlobal('useDisplay', () => ({ mdAndUp: ref(false) }))
        vi.stubGlobal('useLongPressDrag', useLongPressDrag)
        vi.stubGlobal('shallowRef', shallowRef)
    })
    afterEach(() => {
        vi.useRealTimers()
        document.body.innerHTML = ''
    })

    it('keeps the phone drop zones above the home indicator', async () => {
        const wrapper = mount(TaskBoard, {
            props: { query: {}, assigneeNames: new Map() },
            attachTo: document.body,
            global: {
                stubs: {
                    TaskCard: { template: '<div data-testid="card" />' },
                    LayoutTabs: true,
                    UIcon: true,
                },
            },
        })
        await flushPromises()
        const touchstart = new Event('touchstart') as TouchEvent
        Object.defineProperty(touchstart, 'touches', {
            value: [{ clientX: 10, clientY: 10 }],
        })
        wrapper.find('[data-testid="card"]').element.dispatchEvent(touchstart)
        vi.advanceTimersByTime(400)
        await nextTick()

        const zones =
            document.querySelector<HTMLElement>('[data-drop-status]')
                ?.parentElement?.parentElement
        expect(zones?.style.bottom).toContain('var(--app-bottom-inset, 0px)')
        wrapper.unmount()
    })

    it('shows a retryable load error instead of an empty board', async () => {
        vi.mocked(listTasks).mockRejectedValueOnce(new Error('boom'))
        const wrapper = mount(TaskBoard, {
            props: { query: {}, assigneeNames: new Map() },
            global: {
                stubs: {
                    TaskCard: { template: '<div data-testid="card" />' },
                    LayoutTabs: true,
                    UIcon: true,
                },
                mocks: { $t: (key: string) => key },
            },
        })
        await flushPromises()

        expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="task-board"]').exists()).toBe(false)

        await wrapper.get('[data-testid="load-error-retry"]').trigger('click')
        await flushPromises()

        expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
        expect(wrapper.findAll('[data-testid="card"]')).toHaveLength(1)
    })
})
