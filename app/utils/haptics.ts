import { isNativeApp } from './native'

export type Haptic = 'press' | 'success' | 'warning' | 'error'

export const VIBRATION: Record<Haptic, number | number[]> = {
    press: 12,
    success: 60,
    warning: 30,
    error: [40, 60, 40],
}

export async function haptic(kind: Haptic) {
    try {
        if (!isNativeApp()) return void navigator.vibrate?.(VIBRATION[kind])
        const { Haptics, ImpactStyle, NotificationType } =
            await import('@capacitor/haptics')
        if (kind === 'press') await Haptics.impact({ style: ImpactStyle.Light })
        else
            await Haptics.notification({
                type: {
                    success: NotificationType.Success,
                    warning: NotificationType.Warning,
                    error: NotificationType.Error,
                }[kind],
            })
    } catch {}
}
