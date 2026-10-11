export type ThemeMode = 'system' | 'light' | 'dark'
type ThemeName = 'light' | 'dark'

const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']
const THEME_CHANNEL = 'gripello-theme'
const REVEAL_MS = 450

export const isExplicitThemeMode = (value: unknown): value is ThemeName =>
    value === 'light' || value === 'dark'

const isThemeMode = (value: unknown): value is ThemeMode =>
    value === 'system' || isExplicitThemeMode(value)

let channel: BroadcastChannel | null = null
const themeChannel = () => {
    if (!channel && typeof BroadcastChannel !== 'undefined')
        channel = new BroadcastChannel(THEME_CHANNEL)
    return channel
}

export function useThemeMode() {
    const colorMode = useColorMode()
    const mode = computed<ThemeMode>(() =>
        isThemeMode(colorMode.preference) ? colorMode.preference : 'system',
    )

    const systemTheme = (): ThemeName =>
        window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'

    const resolve = (value: ThemeMode): ThemeName =>
        value === 'system' ? systemTheme() : value

    const adoptMode = async (next: ThemeMode, origin?: HTMLElement) => {
        const reduceMotion = window.matchMedia(
            '(prefers-reduced-motion: reduce)',
        ).matches
        // iOS tints its status bar and toolbar from the page and only catches up once a view transition has
        // finished, so the reveal would leave the bars lagging; switch instantly there.
        const iosWebKit = CSS.supports('-webkit-touch-callout', 'none')
        if (
            colorMode.value === resolve(next) ||
            !origin ||
            reduceMotion ||
            iosWebKit ||
            !document.startViewTransition
        ) {
            colorMode.preference = next
            return
        }

        const root = document.documentElement
        const { left, top, width, height } = origin.getBoundingClientRect()
        const x = left + width / 2
        const y = top + height / 2
        const radius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y),
        )

        root.classList.add('theme-reveal')
        try {
            const transition = document.startViewTransition(async () => {
                colorMode.preference = next
                await nextTick()
            })
            await transition.ready
            root.animate(
                {
                    clipPath: [
                        `circle(0px at ${x}px ${y}px)`,
                        `circle(${radius}px at ${x}px ${y}px)`,
                    ],
                },
                {
                    duration: REVEAL_MS,
                    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
                    pseudoElement: '::view-transition-new(root)',
                },
            )
            await transition.finished
        } finally {
            root.classList.remove('theme-reveal')
        }
    }

    const setMode = (next: ThemeMode, origin?: HTMLElement) => {
        themeChannel()?.postMessage(next)
        return adoptMode(next, origin)
    }

    const listenForThemeChanges = () => {
        const onBroadcast = (event: MessageEvent) => {
            if (isThemeMode(event.data)) void adoptMode(event.data)
        }
        themeChannel()?.addEventListener('message', onBroadcast)
        return () => themeChannel()?.removeEventListener('message', onBroadcast)
    }

    return { mode, setMode, listenForThemeChanges }
}
