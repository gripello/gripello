import { describe, expect, it } from 'vitest'
import { competitionTopic } from '~/composables/useCompetitionLive'

describe('competitionTopic', () => {
    it('gives every competition its own topic', () => {
        expect(competitionTopic('c1')).toBe('competition_changes:c1')
        expect(competitionTopic('c1')).not.toBe(competitionTopic('c2'))
    })
})
