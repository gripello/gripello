import { afterEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ value: false }))
const haptics = vi.hoisted(() => ({
    impact: vi.fn(async () => {}),
    notification: vi.fn(async () => {}),
}))
vi.mock('~/utils/native', () => ({ isNativeApp: () => native.value }))
vi.mock('@capacitor/haptics', () => ({
    Haptics: haptics,
    ImpactStyle: { Light: 'LIGHT' },
    NotificationType: {
        Success: 'SUCCESS',
        Warning: 'WARNING',
        Error: 'ERROR',
    },
}))

import { haptic, VIBRATION } from '~/utils/haptics'

describe('haptic', () => {
    afterEach(() => {
        native.value = false
        vi.clearAllMocks()
        vi.unstubAllGlobals()
    })

    it('vibrates in the browser', async () => {
        const vibrate = vi.fn()
        vi.stubGlobal('navigator', { vibrate })
        await haptic('error')
        expect(vibrate).toHaveBeenCalledWith(VIBRATION.error)
        expect(haptics.notification).not.toHaveBeenCalled()
    })

    it('uses the native haptic engine in the app', async () => {
        native.value = true
        await haptic('press')
        await haptic('warning')
        expect(haptics.impact).toHaveBeenCalledWith({ style: 'LIGHT' })
        expect(haptics.notification).toHaveBeenCalledWith({ type: 'WARNING' })
    })

    it('never throws where the device has no vibration', async () => {
        vi.stubGlobal('navigator', {})
        await expect(haptic('success')).resolves.toBeUndefined()
    })
})
