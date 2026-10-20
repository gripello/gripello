import { useEventListener, useIntervalFn, useTimeoutFn } from '@vueuse/core'
import { tvReloadDue } from '~/utils/tvScreen'

const CURSOR_IDLE_MS = 3_000
const RELOAD_CHECK_MS = 60_000

export function useTvKiosk() {
    const nuxtApp = useNuxtApp()
    useLiveGym()
    const cursorHidden = ref(false)
    let wakeLock: WakeLockSentinel | null = null
    let updatePending = false
    let unmounted = false

    const loadedAt = () => new Date(performance.timeOrigin)

    async function checkReload() {
        const now = new Date()
        const due =
            (updatePending && tvReloadDue('update', loadedAt(), now)) ||
            tvReloadDue('nightly', loadedAt(), now)
        if (!due) return
        // an offline reload would leave the screen on the offline page
        const healthy = await fetch('/api/health', { cache: 'no-store' })
            .then((response) => response.ok)
            .catch(() => false)
        if (healthy) location.reload()
    }

    async function lockScreen() {
        if (document.visibilityState !== 'visible') return
        const lock = await navigator.wakeLock
            ?.request('screen')
            .catch(() => null)
        if (unmounted) return void lock?.release().catch(() => {})
        wakeLock = lock ?? null
    }

    const { start: hideCursorSoon } = useTimeoutFn(
        () => (cursorHidden.value = true),
        CURSOR_IDLE_MS,
        { immediate: false },
    )
    function showCursor() {
        cursorHidden.value = false
        hideCursorSoon()
    }
    const { resume: startReloadChecks } = useIntervalFn(
        () => void checkReload(),
        RELOAD_CHECK_MS,
        { immediate: false },
    )

    let removeUpdateHook = () => {}

    onMounted(() => {
        removeUpdateHook = nuxtApp.hook(
            'app:manifest:update',
            () => void (updatePending = true),
        )
        void lockScreen()
        showCursor()
        useEventListener(document, 'visibilitychange', lockScreen)
        useEventListener('pointermove', showCursor)
        startReloadChecks()
    })
    onBeforeUnmount(() => {
        unmounted = true
        removeUpdateHook()
        void wakeLock?.release().catch(() => {})
    })

    return { cursorHidden }
}
