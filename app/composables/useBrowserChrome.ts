import { compositeOver, mixColors } from '~/utils/chromeColor'
import { THEME_COLORS, type ThemeName } from '~/utils/themeColors'

const TWEEN_MS = 320
const SCRIM_SELECTOR = '[data-slot="overlay"][data-state="open"]'
const LIGHT_QUERY = '(prefers-color-scheme: light)'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function useTweenedColor(target: () => string) {
    const shown = ref(target())
    if (import.meta.server) return shown

    let frame = 0
    watch(target, (next) => {
        cancelAnimationFrame(frame)
        const from = shown.value.slice(0, 7)
        const reduceMotion = window.matchMedia(
            '(prefers-reduced-motion: reduce)',
        ).matches
        const startedAt = performance.now()
        const step = (now: number) => {
            const progress = reduceMotion
                ? 1
                : Math.min(1, (now - startedAt) / TWEEN_MS)
            shown.value = mixColors(from, next, 1 - (1 - progress) ** 3)
            if (progress < 1) {
                frame = requestAnimationFrame(step)
                return
            }
            shown.value = `${next}fe`
            frame = requestAnimationFrame(() => (shown.value = next))
        }
        frame = requestAnimationFrame(step)
    })
    return shown
}

export function useBrowserChrome() {
    const colorMode = useColorMode()
    const { lgAndUp } = useDisplay()
    const { mode, listenForThemeChanges } = useThemeMode()
    const scrim = ref<string | null>(null)

    const currentName = (): ThemeName =>
        colorMode.value === 'dark' ? 'dark' : 'light'
    const withScrim = (color: string) =>
        scrim.value ? compositeOver(color, scrim.value) : color
    const barTarget = (name: ThemeName) => withScrim(THEME_COLORS[name].surface)
    const scrimmedPage = () => {
        if (!scrim.value) return undefined
        const page = lgAndUp.value ? 'background' : 'surface'
        return `background-color: ${withScrim(THEME_COLORS[currentName()][page])}`
    }

    const activeBar = useTweenedColor(() => barTarget(currentName()))

    // iOS Safari doesn't re-evaluate media-scoped theme-color tags when the OS appearance flips.
    const themeColorTags = () =>
        import.meta.client || isExplicitThemeMode(mode.value)
            ? [{ media: null, content: activeBar.value }]
            : [
                  { media: LIGHT_QUERY, content: barTarget('light') },
                  { media: DARK_QUERY, content: barTarget('dark') },
              ]

    useHead({
        meta: [
            ...(import.meta.server
                ? themeColorTags().map(({ media, content }) => ({
                      name: 'theme-color',
                      ...(media ? { media } : {}),
                      content,
                  }))
                : []),
            { name: 'color-scheme', content: currentName },
        ],
        htmlAttrs: { style: scrimmedPage },
        bodyAttrs: { style: scrimmedPage },
    })

    if (import.meta.server) return

    let frame = 0
    const observer = new MutationObserver(() => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(
            () =>
                (scrim.value = document.querySelector(SCRIM_SELECTOR)
                    ? THEME_COLORS[currentName()].scrim
                    : null),
        )
    })
    let stopListening: (() => void) | null = null

    const syncThemeColorTags = () => {
        const wanted = themeColorTags()
        const existing = [
            ...document.head.querySelectorAll<HTMLMetaElement>(
                'meta[name="theme-color"]',
            ),
        ]
        existing.slice(wanted.length).forEach((tag) => tag.remove())
        wanted.forEach(({ media, content }, index) => {
            const tag =
                existing[index] ??
                document.head.appendChild(
                    Object.assign(document.createElement('meta'), {
                        name: 'theme-color',
                    }),
                )
            if (media) tag.setAttribute('media', media)
            else tag.removeAttribute('media')
            tag.setAttribute('content', content)
        })
    }

    onMounted(() => {
        watchEffect(syncThemeColorTags)
        stopListening = listenForThemeChanges()
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'data-state'],
        })
    })

    onBeforeUnmount(() => {
        stopListening?.()
        observer.disconnect()
        cancelAnimationFrame(frame)
    })
}
