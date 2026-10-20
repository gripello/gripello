import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
    gymChangesTopic,
    leaderboardTopic,
    moderationTopic,
} from '#shared/utils/topics'

const sources = globSync('app/**/*.{ts,vue}').map((file) => ({
    file,
    text: readFileSync(file, 'utf8'),
}))

const KEYED_PREFIXES =
    /['"`](gym_changes|open_route_defects|competition_changes|competitions|leaderboard|moderation|tasks|gym|user):/

describe('realtime topics', () => {
    it('builds keyed topics', () => {
        expect(gymChangesTopic('g1')).toBe('gym_changes:g1')
        expect(moderationTopic('g1')).toBe('moderation:g1')
        expect(leaderboardTopic('')).toBeNull()
    })

    it('are never spelled out in a subscription call', () => {
        const call =
            /\b(?:useRealtime|useLiveRefresh|subscribeRealtime)(?:<[^>]*>)?\(\s*([^,]*),/g
        const literal = sources.flatMap(({ file, text }) =>
            [...text.matchAll(call)]
                .filter(([, topic]) => /['"`]/.test(topic!))
                .map(([, topic]) => `${file}: ${topic!.trim()}`),
        )
        expect(literal).toEqual([])
    })

    it('keep their names in the shared builders only', () => {
        const offenders = sources
            .filter(({ text }) => KEYED_PREFIXES.test(text))
            .map(({ file }) => file)
        expect(offenders).toEqual([])
    })
})
