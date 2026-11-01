import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref, shallowRef } from 'vue'
import TaskBoard from '~/components/task/Board.vue'
import { useLongPressDrag } from '~/composables/useLongPressDrag'
import { listTasks, setTaskStatus } from '~/api/tasks'

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

describe('TaskBoard moving tasks', () => {
    const success = vi.fn()
    const failed = vi.fn()
    const desktop = ref(true)
    let mounted: VueWrapper[] = []

    beforeEach(() => {
        success.mockReset()
        failed.mockReset()
        desktop.value = true
        vi.mocked(listTasks).mockClear()
        vi.mocked(setTaskStatus)
            .mockReset()
            .mockImplementation(
                async (id: string, status: string) =>
                    ({
                        id,
                        kind: 'defect',
                        status,
                        priority: 2,
                    }) as never,
            )
        vi.stubGlobal('useCurrentGymId', () => ref('gym1'))
        vi.stubGlobal('useAsyncAction', () => ({
            run: async (
                action: () => Promise<void>,
                options: { success: string },
            ) => {
                try {
                    await action()
                    success(options.success)
                } catch {
                    failed()
                }
            },
        }))
        vi.stubGlobal('useDisplay', () => ({ mdAndUp: desktop }))
        vi.stubGlobal('useLongPressDrag', useLongPressDrag)
        vi.stubGlobal('shallowRef', shallowRef)
    })
    afterEach(() => {
        mounted.forEach((wrapper) => wrapper.unmount())
        mounted = []
        document.body.innerHTML = ''
    })

    async function mountBoard() {
        const wrapper = mount(TaskBoard, {
            props: { query: { wall: 'w1' } as never, assigneeNames: new Map() },
            attachTo: document.body,
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    TaskCard: {
                        props: ['task'],
                        emits: ['status', 'edit'],
                        template: `<div data-testid="card" :data-id="task.id">
                            <button data-testid="card-done" @click="$emit('status', task, 'done')" />
                            <button data-testid="card-edit" @click="$emit('edit', task)" />
                        </div>`,
                    },
                    LayoutTabs: true,
                    UIcon: true,
                },
            },
        })
        mounted.push(wrapper)
        await flushPromises()
        return wrapper
    }

    const cardsIn = (wrapper: VueWrapper, status: string) =>
        wrapper
            .get(`[data-testid="task-column-${status}"]`)
            .findAll('[data-testid="card"]')
            .map((card) => card.attributes('data-id'))

    function dragEvent(type: string, transfer: DataTransfer) {
        return Object.defineProperty(
            new Event(type, { bubbles: true, cancelable: true }),
            'dataTransfer',
            { value: transfer },
        )
    }

    function fakeTransfer() {
        const data = new Map<string, string>()
        return {
            effectAllowed: '',
            setData: (type: string, value: string) => data.set(type, value),
            getData: (type: string) => data.get(type) ?? '',
        } as unknown as DataTransfer
    }

    it('loads open work and recent done tasks with the board query', async () => {
        await mountBoard()
        const queries = vi
            .mocked(listTasks)
            .mock.calls.map(([gym, query]) => [gym, query])
        expect(queries).toContainEqual([
            'gym1',
            expect.objectContaining({
                wall: 'w1',
                status: ['done'],
                sort: '-done_at',
                limit: 30,
            }),
        ])
        expect(queries).toContainEqual([
            'gym1',
            expect.objectContaining({
                wall: 'w1',
                status: expect.not.arrayContaining(['done']),
                limit: 200,
            }),
        ])
    })

    it('moves a task dragged into another column and announces the change', async () => {
        const wrapper = await mountBoard()
        expect(cardsIn(wrapper, 'open')).toEqual(['task1'])
        const transfer = fakeTransfer()
        wrapper
            .get('[data-testid="card"]')
            .element.dispatchEvent(dragEvent('dragstart', transfer))
        const column = wrapper.get('[data-testid="task-column-in_progress"]')
        column.element.dispatchEvent(dragEvent('dragover', transfer))
        await nextTick()
        expect(column.classes()).toContain('ring-primary')
        column.element.dispatchEvent(dragEvent('drop', transfer))
        await flushPromises()

        expect(setTaskStatus).toHaveBeenCalledWith('task1', 'in_progress')
        expect(success).toHaveBeenCalledWith('tasks.statusChanged.in_progress')
        expect(cardsIn(wrapper, 'open')).toEqual([])
        expect(cardsIn(wrapper, 'in_progress')).toEqual(['task1'])
        expect(column.classes()).not.toContain('ring-primary')
    })

    it('ignores drops into the same column and drops of foreign data', async () => {
        const wrapper = await mountBoard()
        const transfer = fakeTransfer()
        wrapper
            .get('[data-testid="card"]')
            .element.dispatchEvent(dragEvent('dragstart', transfer))
        wrapper
            .get('[data-testid="task-column-open"]')
            .element.dispatchEvent(dragEvent('drop', transfer))
        wrapper
            .get('[data-testid="task-column-done"]')
            .element.dispatchEvent(dragEvent('drop', fakeTransfer()))
        await flushPromises()
        expect(setTaskStatus).not.toHaveBeenCalled()
    })

    it('keeps the task where it was when saving the status fails', async () => {
        vi.mocked(setTaskStatus).mockRejectedValue(new Error('down'))
        const wrapper = await mountBoard()
        await wrapper.get('[data-testid="card-done"]').trigger('click')
        await flushPromises()
        expect(setTaskStatus).toHaveBeenCalledWith('task1', 'done')
        expect(failed).toHaveBeenCalledOnce()
        expect(success).not.toHaveBeenCalled()
        expect(cardsIn(wrapper, 'open')).toEqual(['task1'])
    })

    it('passes edits from a card up', async () => {
        const wrapper = await mountBoard()
        await wrapper.get('[data-testid="card-edit"]').trigger('click')
        expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({
            id: 'task1',
        })
    })

    it('reloads when the query changes', async () => {
        const wrapper = await mountBoard()
        vi.mocked(listTasks).mockClear()
        await wrapper.setProps({ query: { wall: 'w2' } as never })
        await flushPromises()
        expect(listTasks).toHaveBeenCalledTimes(2)
        expect(vi.mocked(listTasks).mock.calls[0]?.[1]).toMatchObject({
            wall: 'w2',
        })
    })

    describe('on phones', () => {
        beforeEach(() => {
            desktop.value = false
            vi.useFakeTimers()
        })
        afterEach(() => vi.useRealTimers())

        const touch = (type: string, x: number, y: number) =>
            Object.defineProperties(
                new Event(type, { bubbles: true, cancelable: true }),
                {
                    touches: {
                        value:
                            type === 'touchend'
                                ? []
                                : [{ clientX: x, clientY: y }],
                    },
                    changedTouches: { value: [{ clientX: x, clientY: y }] },
                },
            ) as TouchEvent

        it('moves a long-pressed task onto a drop zone for another status', async () => {
            const wrapper = await mountBoard()
            wrapper
                .get('[data-testid="card"]')
                .element.dispatchEvent(touch('touchstart', 10, 10))
            vi.advanceTimersByTime(400)
            await nextTick()
            const zones = [
                ...document.querySelectorAll<HTMLElement>('[data-drop-status]'),
            ].map((zone) => zone.dataset.dropStatus)
            expect(zones).not.toContain('open')
            expect(zones).toContain('dismissed')

            const done = document.querySelector(
                '[data-testid="task-drop-done"]',
            )!
            document.elementFromPoint = () => done
            window.dispatchEvent(touch('touchmove', 100, 500))
            window.dispatchEvent(touch('touchend', 100, 500))
            await flushPromises()
            expect(setTaskStatus).toHaveBeenCalledWith('task1', 'done')
            expect(
                document.querySelector('[data-testid="task-drop-overlay"]'),
            ).toBeNull()
        })

        it('releases a long press outside any drop zone without changes', async () => {
            const wrapper = await mountBoard()
            wrapper
                .get('[data-testid="card"]')
                .element.dispatchEvent(touch('touchstart', 10, 10))
            vi.advanceTimersByTime(400)
            await nextTick()
            document.elementFromPoint = () => document.body
            window.dispatchEvent(touch('touchmove', 100, 100))
            window.dispatchEvent(touch('touchend', 100, 100))
            await flushPromises()
            expect(setTaskStatus).not.toHaveBeenCalled()
        })

        it('swipes between status columns but not past the ends', async () => {
            const wrapper = await mountBoard()
            const board = wrapper.get('[data-testid="task-board"]').element
            const swipe = async (from: number, to: number, dy = 0) => {
                board.dispatchEvent(touch('touchstart', from, 100))
                board.dispatchEvent(touch('touchend', to, 100 + dy))
                await nextTick()
            }
            const shown = () =>
                wrapper
                    .findAll('section')
                    .map((section) => section.attributes('data-testid'))

            expect(shown()).toEqual(['task-column-open'])
            await swipe(300, 290)
            await swipe(300, 200, 80)
            expect(shown()).toEqual(['task-column-open'])
            await swipe(300, 100)
            expect(shown()).toEqual(['task-column-in_progress'])
            await swipe(100, 300)
            await swipe(100, 300)
            expect(shown()).toEqual(['task-column-open'])
        })
    })
})
