import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
    listenBeforeRouter,
    pushDialogEntry,
    settleDialogHistory,
} from '~/utils/dialogHistory'

function back(state: unknown) {
    const routerListener = vi.fn()
    window.addEventListener('popstate', routerListener)
    window.dispatchEvent(new PopStateEvent('popstate', { state }))
    window.removeEventListener('popstate', routerListener)
    return routerListener
}

describe('dialog history', () => {
    beforeAll(listenBeforeRouter)
    const releases: (() => void)[] = []
    afterEach(() => {
        releases.splice(0).forEach((release) => release())
    })

    it('closes the open dialog on back instead of letting the router navigate', () => {
        history.replaceState({ position: 3 }, '')
        const close = vi.fn()
        releases.push(pushDialogEntry(close))
        expect(history.state).toMatchObject({ position: 3 })
        expect(history.state.dialogShell).toBeTypeOf('number')

        const routerListener = back({ position: 3 })

        expect(close).toHaveBeenCalledOnce()
        expect(routerListener).not.toHaveBeenCalled()
    })

    it('closes only the top dialog when they are stacked', () => {
        const closeParent = vi.fn()
        const closeChild = vi.fn()
        releases.push(pushDialogEntry(closeParent))
        const parentState = history.state
        releases.push(pushDialogEntry(closeChild))

        back(parentState)

        expect(closeChild).toHaveBeenCalledOnce()
        expect(closeParent).not.toHaveBeenCalled()
    })

    it('steps back over its own entry when closed by the user, unseen by the router', () => {
        const historyBack = vi
            .spyOn(history, 'back')
            .mockImplementation(() => {})
        pushDialogEntry(vi.fn())()
        expect(historyBack).toHaveBeenCalledOnce()

        expect(back({ position: 3 })).not.toHaveBeenCalled()
        expect(back({ position: 2 })).toHaveBeenCalledOnce()
        historyBack.mockRestore()
    })

    it('leaves history alone when the router already moved to another page', () => {
        const historyBack = vi.spyOn(history, 'back')
        const release = pushDialogEntry(vi.fn())
        history.pushState({ position: 4 }, '', '/other')

        release()

        expect(historyBack).not.toHaveBeenCalled()
        expect(back({ position: 3 })).toHaveBeenCalledOnce()
        historyBack.mockRestore()
    })

    it('steps back over open dialogs before the router writes a navigation', async () => {
        const historyGo = vi.spyOn(history, 'go').mockImplementation(() => {})
        const close = vi.fn()
        pushDialogEntry(close)
        pushDialogEntry(close)

        let settled = false
        void settleDialogHistory()?.then(() => (settled = true))
        expect(historyGo).toHaveBeenCalledWith(-2)
        await Promise.resolve()
        expect(settled).toBe(false)

        expect(back({ position: 3 })).not.toHaveBeenCalled()
        await Promise.resolve()
        expect(settled).toBe(true)
        expect(close).not.toHaveBeenCalled()
        historyGo.mockRestore()
    })

    it('holds a navigation until a closing dialog stepped back', async () => {
        const historyBack = vi
            .spyOn(history, 'back')
            .mockImplementation(() => {})
        pushDialogEntry(vi.fn())()

        let settled = false
        void settleDialogHistory()?.then(() => (settled = true))
        await Promise.resolve()
        expect(settled).toBe(false)

        back({ position: 3 })
        await Promise.resolve()
        expect(settled).toBe(true)
        historyBack.mockRestore()
    })

    it('lets a navigation through when no dialog is open', () => {
        expect(settleDialogHistory()).toBeUndefined()
    })
})
