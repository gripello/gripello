import { describe, expect, it } from 'vitest'
import {
    competitionTopic,
    gymCompetitionsTopic,
} from '~/composables/useCompetitionLive'

describe('competitionTopic', () => {
    it('gives every competition its own topic', () => {
        expect(competitionTopic('c1')).toBe('competition_changes:c1')
        expect(competitionTopic('c1')).not.toBe(competitionTopic('c2'))
    })
})

describe('gymCompetitionsTopic', () => {
    it('names the gym topic, or nothing without a gym', () => {
        expect(gymCompetitionsTopic('g1')).toBe('competitions:g1')
        expect(gymCompetitionsTopic('')).toBe(null)
    })
})
