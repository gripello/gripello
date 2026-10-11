import { describe, it, expect, vi, beforeEach } from 'vitest'
import { h } from 'vue'
import { useNotification } from '~/composables/useNotification'

const add = vi.fn()

beforeEach(() => {
    add.mockClear()
    vi.stubGlobal('useToast', () => ({ add }))
    vi.stubGlobal('h', h)
})

describe('useNotification', () => {
    it('shows a coloured toast with a matching icon in the browser', () => {
        process.server = false
        useNotification().error('Nope')
        expect(add).toHaveBeenCalledWith(
            expect.objectContaining({
                color: 'error',
                icon: 'i-lucide-circle-alert',
                'data-testid': 'global-snackbar',
            }),
        )
    })

    it('keeps incoming announcements apart from feedback toasts', () => {
        process.server = false
        useNotification().announce('Achievement unlocked')
        const toast = add.mock.calls[0]![0]
        expect(toast['data-testid']).toBe('announcement-toast')
        expect(toast.title().props['data-testid']).toBe(
            'announcement-toast-message',
        )
    })

    it('skips toasts during server rendering so the payload stays serialisable', () => {
        process.server = true
        useNotification().success('Saved')
        expect(add).not.toHaveBeenCalled()
    })
})
