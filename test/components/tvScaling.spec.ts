import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TV_FILES = [
    ...readdirSync('app/components/tv').map((name) =>
        join('app/components/tv', name),
    ),
    'app/pages/[gym]/tv.vue',
    'app/pages/[gym]/leaderboard/tv.vue',
    'app/pages/[gym]/competitions/[id]/tv.vue',
]

describe('TV screens', () => {
    it('scale through the root font size, never through width breakpoints', () => {
        const offenders = TV_FILES.filter((file) =>
            /\b(sm|md|lg|xl|2xl):/.test(readFileSync(file, 'utf8')),
        )
        expect(offenders).toEqual([])
    })

    it('shrink the root font size on small screens without a floor', () => {
        const shell = readFileSync('app/components/tv/Shell.vue', 'utf8')
        expect(shell).toContain('font-size: min(1.48vmin, 0.833vmax)')
    })
})
