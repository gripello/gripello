import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { AVATAR_COLORS } from '~/utils/avatar'
import { contrastRatio } from '~/utils/color'
import { THEME_COLORS } from '~/utils/themeColors'

const css = readFileSync('app/assets/css/main.css', 'utf8')
const NEUTRAL: Record<string, string> = {
    'var(--ui-color-neutral-400)': '#a1a1a1',
}
const NUXT_UI_DEFAULTS = {
    light: { '--ui-bg-elevated': '#f5f5f5' },
    dark: {},
}

function tokens(selector: ':root' | '.dark') {
    const start = css.indexOf(`    ${selector} {\n        --app-bg`)
    const block = css.slice(start, css.indexOf('}', start))
    return Object.fromEntries(
        [...block.matchAll(/(--[\w-]+): ([^;]+);/g)].map(([, name, value]) => [
            name!,
            NEUTRAL[value!] ?? value!,
        ]),
    ) as Record<string, string>
}

function blend(color: string, background: string, alpha: number) {
    const channels = (hex: string) =>
        [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const [fg, bg] = [channels(color), channels(background)]
    return `#${fg
        .map((c, i) =>
            Math.round(c * alpha + bg[i]! * (1 - alpha))
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')}`
}

const themes = {
    light: { ...NUXT_UI_DEFAULTS.light, ...tokens(':root') },
    dark: { ...NUXT_UI_DEFAULTS.dark, ...tokens('.dark') },
}

describe.each(Object.entries(themes))('%s theme contrast', (name, t) => {
    const surfaces = [
        t['--ui-bg']!,
        t['--ui-bg-muted']!,
        t['--ui-bg-elevated']!,
        t['--app-bg']!,
    ]

    it('keeps muted text readable on every surface and on warning tints', () => {
        for (const surface of [
            ...surfaces,
            blend(t['--ui-warning']!, t['--ui-bg']!, 0.1),
        ])
            expect(
                contrastRatio(t['--ui-text-muted']!, surface),
                `muted on ${surface}`,
            ).toBeGreaterThanOrEqual(4.5)
    })

    it('keeps dimmed placeholders readable on the page and input background', () => {
        for (const surface of [t['--ui-bg']!, t['--app-bg']!])
            expect(
                contrastRatio(t['--ui-text-dimmed']!, surface),
            ).toBeGreaterThanOrEqual(4.5)
    })

    it('keeps soft success and warning badges and alerts readable', () => {
        for (const token of ['--ui-success', '--ui-warning']) {
            const tint = blend(t[token]!, t['--ui-bg']!, 0.1)
            const description = blend(t[token]!, tint, 0.9)
            expect(
                contrastRatio(description, tint),
                token,
            ).toBeGreaterThanOrEqual(4.5)
        }
    })

    it('keeps the chart palette in sync with the CSS tokens', () => {
        const palette = THEME_COLORS[name as 'light' | 'dark']
        expect(palette.success).toBe(t['--ui-success'])
        expect(palette.warning).toBe(t['--ui-warning'])
        expect(palette.background).toBe(t['--app-bg'])
    })
})

describe('avatar palette', () => {
    it.each(AVATAR_COLORS)('keeps white initials readable on %s', (color) => {
        expect(contrastRatio('#ffffff', color)).toBeGreaterThanOrEqual(4.5)
    })
})

describe('faded text', () => {
    it('never fades small text with an opacity utility', () => {
        const vueFiles = (
            readdirSync('app', {
                recursive: true,
                encoding: 'utf8',
            }) as string[]
        ).filter((file) => file.endsWith('.vue'))
        const faded = vueFiles.filter((file) =>
            /class="[^"]*\btext-(?:xs|sm)\b[^"]*\bopacity-\d+|class="[^"]*\bopacity-\d+[^"]*\btext-(?:xs|sm)\b/.test(
                readFileSync(join('app', file), 'utf8'),
            ),
        )
        expect(faded).toEqual([])
    })
})

describe('text colours', () => {
    it('never fades the highlighted text colour for text, only for decorative icons', () => {
        const files = [
            'assets/css/main.css',
            ...(
                readdirSync('app', {
                    recursive: true,
                    encoding: 'utf8',
                }) as string[]
            ).filter((file) => file.endsWith('.vue')),
        ]
        const faded = files.flatMap((file) =>
            [
                ...readFileSync(join('app', file), 'utf8').matchAll(
                    /([^{}]+)\{[^{}]*?(?<![-\w])color:\s*color-mix\(\s*in oklab,\s*var\(--ui-text-highlighted\)/g,
                ),
            ]
                .map((match) => match[1]!.trim())
                .filter((selector) => !/icon|error-code/.test(selector))
                .map((selector) => `${file}: ${selector}`),
        )
        expect(faded).toEqual([])
    })
})
