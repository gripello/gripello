import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(import.meta.dirname, '../../app/pages/[gym]/index.vue'),
    'utf8',
)

describe('gym overview page', () => {
    it('leaves out on phones what the bars and tabs already show', () => {
        expect(source).toMatch(/overview-hero__title max-lg:sr-only/)
        expect(source).toMatch(
            /<span class="max-lg:hidden">\s+·\s+<NuxtLink[\s\S]+?data-testid="overview-all-routes"/,
        )
        expect(source).toMatch(
            /class="max-lg:hidden"\s+data-testid="overview-open-map"/,
        )
        expect(source).toMatch(/<AuthGuestCta\s+v-else\s+class="max-lg:hidden"/)
        expect(source).not.toContain('openLogbook')
    })

    it('counts new routes over the same window the Newly set list uses', () => {
        expect(source).toContain(
            "$t('overview.newCount', { n: freshRoutes.length })",
        )
        expect(source).toMatch(/<section v-if="freshRoutes\.length"/)
    })
})

describe('gym overview live blocks', () => {
    it('shows each block only when it has something to show', () => {
        expect(source).toMatch(/<CompetitionCard\s+v-if="liveCompetition"/)
        expect(source).toMatch(
            /v-if="resets\.length"[\s\S]+?data-testid="overview-resets"/,
        )
        expect(source).toMatch(
            /v-if="topBoard"\s+data-testid="overview-leaderboard"/,
        )
    })

    it('keeps the blocks live', () => {
        expect(source).toContain('useGymCompetitionsLive(refreshCompetitions)')
        expect(source).toMatch(
            /useLiveRefresh\(\(\) => leaderboardTopic\(gymId\.value\), refreshBoards/,
        )
        expect(source).toMatch(
            /hydrated\.value\s+\? plannedResets\(routes\.value, wallRecords\.value, new Date\(\)\)\s+: \[\]/,
        )
    })
})
