import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { ApiError } from '~/api/client'

const notifySuccess = vi.fn()
const notifyError = vi.fn()
const notify = vi.fn()
vi.stubGlobal('useNotification', () => ({
    success: notifySuccess,
    error: notifyError,
    notify,
}))

beforeEach(() => {
    notifySuccess.mockReset()
    notifyError.mockReset()
    notify.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useAsyncAction', () => {
    it('returns the result, toggles pending and notifies success', async () => {
        const { pending, run } = useAsyncAction()
        const running = run(async () => 42, { success: 'saved' })
        expect(pending.value).toBe(true)
        expect(await running).toBe(42)
        expect(pending.value).toBe(false)
        expect(notifySuccess).toHaveBeenCalledWith('saved')
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('notifies the generic error by default', async () => {
        const { pending, run } = useAsyncAction()
        const result = await run(() => Promise.reject(new Error('boom')), {
            success: 'saved',
        })
        expect(result).toBeUndefined()
        expect(pending.value).toBe(false)
        expect(notifySuccess).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledWith('notifications.error.generic')
    })

    it('uses a custom error message or resolver', async () => {
        const { run } = useAsyncAction()
        await run(() => Promise.reject(new Error('x')), { error: 'custom' })
        expect(notifyError).toHaveBeenLastCalledWith('custom')

        await run(() => Promise.reject({ status: 400 }), {
            error: (error) =>
                (error as { status: number }).status === 400
                    ? 'in-use'
                    : 'other',
        })
        expect(notifyError).toHaveBeenLastCalledWith('in-use')
    })

    it('ignores abort errors', async () => {
        const { run } = useAsyncAction()
        const result = await run(() => Promise.reject({ isAbort: true }))
        expect(result).toBeUndefined()
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('lets the caller handle an error without the generic toast', async () => {
        const { run } = useAsyncAction()
        const handled = vi.fn(() => true)
        await run(() => Promise.reject({ status: 400 }), { handled })
        expect(handled).toHaveBeenCalledWith({ status: 400 })
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('offers to sign in again instead of a generic error when the session ended', async () => {
        const { run } = useAsyncAction()
        const ended = Object.assign(Object.create(ApiError.prototype), {
            status: 401,
            sessionEnded: true,
        })
        await run(() => Promise.reject(ended))
        expect(notifyError).not.toHaveBeenCalled()
        expect(notify).toHaveBeenCalledWith(
            'errors.sessionEnded',
            'warning',
            expect.objectContaining({ label: 'routes.login' }),
            'session-ended',
        )
    })

    it('names a rate limit instead of the generic error', async () => {
        const { run } = useAsyncAction()
        await run(() => Promise.reject({ status: 429 }))
        expect(notifyError).toHaveBeenCalledWith('errors.rateLimited')
    })

    it('names a rate limit even when the caller passes its own error text', async () => {
        const { run } = useAsyncAction()
        await run(() => Promise.reject({ status: 429 }), { error: 'Custom' })
        expect(notifyError).toHaveBeenLastCalledWith('errors.rateLimited')
        await run(() => Promise.reject({ status: 500 }), { error: 'Custom' })
        expect(notifyError).toHaveBeenLastCalledWith('Custom')
    })
})
