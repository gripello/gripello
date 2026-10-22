import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'

const route = reactive<{ query: Record<string, string> }>({ query: {} })
const replace = vi.fn()
const getTask = vi.fn()

vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useRouter', () => ({ replace }))
vi.stubGlobal('onMounted', (run: () => void) => run())
vi.mock('~/api/tasks', () => ({ getTask: (id: string) => getTask(id) }))

const { useLinkedTask } = await import('~/composables/useLinkedTask')

function setup() {
    const dialogOpen = ref(false)
    const open = vi.fn(() => (dialogOpen.value = true))
    useLinkedTask(ref('g1'), dialogOpen, open)
    return { dialogOpen, open }
}

describe('useLinkedTask', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        route.query = {}
        getTask.mockImplementation(async (id: string) =>
            id === 'missing'
                ? Promise.reject(new Error('404'))
                : { id, gym: id === 'other' ? 'g2' : 'g1' },
        )
    })

    it('opens the linked task on arrival', async () => {
        route.query = { task: 't1' }
        const { open } = setup()
        await flushPromises()
        expect(open).toHaveBeenCalledWith({ id: 't1', gym: 'g1' })
    })

    it('opens a task linked while the page is already open', async () => {
        const { open } = setup()
        route.query = { task: 't2' }
        await flushPromises()
        expect(open).toHaveBeenCalledWith({ id: 't2', gym: 'g1' })
    })

    it('ignores unknown tasks and tasks of another gym', async () => {
        route.query = { task: 'missing' }
        const { open } = setup()
        route.query = { task: 'other' }
        await flushPromises()
        expect(open).not.toHaveBeenCalled()
    })

    it('drops the link when the dialog closes', async () => {
        route.query = { task: 't1', q: 'bolt' }
        const { dialogOpen } = setup()
        await flushPromises()
        dialogOpen.value = false
        await nextTick()
        expect(replace).toHaveBeenCalledWith({ query: { q: 'bolt' } })
    })
})
