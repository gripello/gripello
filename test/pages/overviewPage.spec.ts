import { leaderboardTopic } from '#shared/utils/topics'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(import.meta.dirname, '../../app/pages/[gym]/index.vue'),
    'utf8',
)

describe('gym overview page', () => {
    it('leaves out on phones what the bars and tabs already show', () => {
        expect(source).toMatch(/text-highlighted max-lg:sr-only/)
        expect(source).toMatch(/class="mt-1 text-muted max-lg:hidden"/)
        expect(source).toMatch(
            /<div class="flex gap-2 max-lg:hidden">[\s\S]+?data-testid="overview-all-routes"[\s\S]+?data-testid="overview-open-map"/,
        )
        expect(source).toMatch(/<AuthGuestCta\s+v-else\s+class="max-lg:hidden"/)
    })

    it('puts progress and leaderboard first on phones', () => {
        expect(source).toContain(
            '<aside class="flex flex-col gap-6 max-lg:order-first">',
        )
    })

    it('puts opening hours and address before the climbing content', () => {
        expect(source.indexOf('<OverviewGymStatus')).toBeLessThan(
            source.indexOf('<OverviewWallRails'),
        )
    })
})

describe('gym overview status strip', () => {
    const strip = readFileSync(
        path.resolve(
            import.meta.dirname,
            '../../app/components/overview/GymStatus.vue',
        ),
        'utf8',
    )

    it('renders on the server whenever the gym has hours, not only once the clock runs', () => {
        expect(strip).toContain('v-if="hasHours || directionsHref"')
    })
})

describe('gym overview live blocks', () => {
    it('shows each block only when it has something to show', () => {
        expect(source).toMatch(/<CompetitionCard\s+v-if="liveCompetition"/)
        expect(source).toMatch(
            /v-if="walls\.length"[\s\S]+?data-testid="overview-walls"/,
        )
        expect(source).toMatch(
            /v-if="topBoard"[\s\S]+?data-testid="overview-leaderboard"/,
        )
    })

    it('lets climbers switch between the boulder and route boards', () => {
        expect(source).toMatch(
            /v-if="boardItems\.length > 1"\s+v-model="boardKind"/,
        )
        expect(source).toContain('board.rows.length')
    })

    it('keeps the blocks live', () => {
        expect(source).toContain('useGymCompetitionsLive(refreshCompetitions)')
        expect(source).toMatch(
            /useLiveRefresh\(\(\) => leaderboardTopic\(gymId\.value\), refreshBoards/,
        )
    })
})
