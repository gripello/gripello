import { tvReloadDue } from '~/utils/tvScreen'

const CURSOR_IDLE_MS = 3_000
const RELOAD_CHECK_MS = 60_000

export function useTvKiosk() {
    const nuxtApp = useNuxtApp()
    useLiveGym()
    const cursorHidden = ref(false)
    let wakeLock: WakeLockSentinel | null = null
    let cursorTimer: ReturnType<typeof setTimeout> | undefined
    let reloadTimer: ReturnType<typeof setInterval> | undefined
    let updatePending = false

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
        wakeLock = await navigator.wakeLock?.request('screen').catch(() => null)
    }

    function showCursor() {
        cursorHidden.value = false
        clearTimeout(cursorTimer)
        cursorTimer = setTimeout(
            () => (cursorHidden.value = true),
            CURSOR_IDLE_MS,
        )
    }

    let removeUpdateHook = () => {}

    onMounted(() => {
        removeUpdateHook = nuxtApp.hook(
            'app:manifest:update',
            () => void (updatePending = true),
        )
        void lockScreen()
        showCursor()
        document.addEventListener('visibilitychange', lockScreen)
        window.addEventListener('pointermove', showCursor)
        reloadTimer = setInterval(() => void checkReload(), RELOAD_CHECK_MS)
    })
    onBeforeUnmount(() => {
        removeUpdateHook()
        document.removeEventListener('visibilitychange', lockScreen)
        window.removeEventListener('pointermove', showCursor)
        clearTimeout(cursorTimer)
        clearInterval(reloadTimer)
        void wakeLock?.release().catch(() => {})
    })

    return { cursorHidden }
}
