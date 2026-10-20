import type { RouteLocationNormalized } from 'vue-router'
import { useDiscardConfirm } from '~/composables/useDiscardConfirm'

const go = vi.fn()
const push = vi.fn(async () => {})
const to = (fullPath: string) => ({ fullPath }) as RouteLocationNormalized

function setup(changed = true) {
    vi.stubGlobal('useRouter', () => ({ go, push }))
    return useDiscardConfirm(() => changed)
}

beforeEach(() => {
    go.mockClear()
    push.mockClear()
})

describe('useDiscardConfirm leave guard', () => {
    it('lets a page without changes go', async () => {
        window.history.replaceState({ current: '/more', position: 0 }, '')
        await expect(setup(false).leaveGuard(to('/more'))).resolves.toBe(true)
    })

    it('asks right away before a link leaves unsaved changes', async () => {
        window.history.replaceState({ current: '/settings', position: 1 }, '')
        const { leaveGuard, discardDialogOpen, settleDiscard } = setup()
        const decision = leaveGuard(to('/other'))
        expect(discardDialogOpen.value).toBe(true)
        settleDiscard(true)
        await expect(decision).resolves.toBe(true)
    })

    it('restores history before asking about a back step, then repeats it on confirm', async () => {
        window.history.replaceState({ current: '/more', position: 0 }, '')
        const { leaveGuard, discardDialogOpen, settleDiscard } = setup()
        expect(leaveGuard(to('/more'))).toBe(false)
        expect(discardDialogOpen.value).toBe(false)

        window.history.replaceState({ current: '/settings', position: 1 }, '')
        window.dispatchEvent(new PopStateEvent('popstate'))
        expect(discardDialogOpen.value).toBe(true)

        settleDiscard(true)
        await vi.waitFor(() => expect(go).toHaveBeenCalledWith(-1))
        expect(leaveGuard(to('/more'))).toBe(true)
        expect(leaveGuard(to('/more'))).toBeInstanceOf(Promise)
    })

    it('asks right away when history carries no position', async () => {
        window.history.replaceState({ current: '/more' }, '')
        const { leaveGuard, discardDialogOpen, settleDiscard } = setup()
        const decision = leaveGuard(to('/more'))
        expect(discardDialogOpen.value).toBe(true)
        settleDiscard(true)
        await expect(decision).resolves.toBe(true)
    })

    it('navigates instead of reloading when the restored entry is the target', async () => {
        window.history.replaceState({ current: '/more', position: 1 }, '')
        const { leaveGuard, settleDiscard } = setup()
        leaveGuard(to('/more'))
        window.dispatchEvent(new PopStateEvent('popstate'))
        settleDiscard(true)
        await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/more'))
        expect(go).not.toHaveBeenCalled()
    })

    it('stays when the back-step question is dismissed', async () => {
        window.history.replaceState({ current: '/more', position: 0 }, '')
        const { leaveGuard, discardDialogOpen, settleDiscard } = setup()
        leaveGuard(to('/more'))
        window.history.replaceState({ current: '/settings', position: 1 }, '')
        window.dispatchEvent(new PopStateEvent('popstate'))

        settleDiscard(false)
        await new Promise((resolve) => setTimeout(resolve))
        expect(discardDialogOpen.value).toBe(false)
        expect(go).not.toHaveBeenCalled()
    })
})
