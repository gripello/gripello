import { readFileSync } from 'node:fs'

const FILES = [
    'app/components/layout/CommandPalette.vue',
    'app/pages/[gym]/manage/inventory.vue',
    'app/assets/css/main.css',
]

describe('viewport heights', () => {
    it.each(FILES)(
        '%s sizes by the visible viewport, not the one behind phone browser bars',
        (file) => {
            const heights = readFileSync(file, 'utf8')
                .split('\n')
                .filter((line) => /height|max-h-/.test(line))
            expect(heights.filter((line) => /\d+vh\b/.test(line))).toEqual([])
        },
    )

    it.each(FILES.slice(1))(
        '%s keeps inner scroll lists steady while phone toolbars show and hide',
        (file) => {
            const maxHeights = readFileSync(file, 'utf8')
                .split('\n')
                .filter((line) => line.includes('max-height'))
            expect(maxHeights.filter((line) => /dvh\b/.test(line))).toEqual([])
        },
    )
})
