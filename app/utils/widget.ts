import { registerPlugin } from '@capacitor/core'
import type { useAuthState } from '~/api/auth'

// The home-screen widgets (iOS GripelloWidget, Android widget/) read the logbook with the session handed over here.
export interface WidgetPlugin {
    setSession(options: {
        token: string
        userId: string
        origin: string
    }): Promise<void>
    clearSession(): Promise<void>
    reload(): Promise<void>
}

export const widgetPlugin = () => registerPlugin<WidgetPlugin>('GripelloWidget')

export function connectWidget(
    plugin: WidgetPlugin,
    auth: ReturnType<typeof useAuthState>,
    origin: string,
) {
    // A widget is optional: an older app build without the plugin must not break the page.
    const quietly = (call: Promise<void>) => void call.catch(() => null)
    let pushed: string | null = null
    const stop = auth.onAuthChange((token, record) => {
        const next = token && record?.id ? token : ''
        // Profile saves fire too; only a new token or a sign-out reaches the widget.
        if (next === pushed) return
        pushed = next
        if (next)
            quietly(plugin.setSession({ token, userId: record!.id, origin }))
        else quietly(plugin.clearSession())
    }, true)
    // Leaving the app after logging a session redraws the widget with it.
    const onVisibility = () => {
        if (document.visibilityState === 'hidden') quietly(plugin.reload())
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
        stop()
        document.removeEventListener('visibilitychange', onVisibility)
    }
}
