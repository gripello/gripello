import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(
        import.meta.dirname,
        '../../app/pages/[gym]/leaderboard/index.vue',
    ),
    'utf8',
)

describe('leaderboard page', () => {
    it('tells climbers with private sends that they are hidden too', () => {
        expect(source).toContain(
            '!!authStore.record?.leaderboard_hidden || !!authStore.record?.ticks_private',
        )
        expect(source).toMatch(
            /v-if="hidden"[\s\S]+?to: '\/account\/settings\?tab=privacy'[\s\S]+?data-testid="leaderboard-hidden"/,
        )
    })
})
