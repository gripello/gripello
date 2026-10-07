import { describe, it, expect } from 'vitest'
import { reportContentUrl, REPORT_REASONS } from '~/utils/reports'

describe('reportContentUrl', () => {
    it('addresses a comment as an anchor on its route page', () => {
        expect(reportContentUrl('rating', 'cmt123', 'rt456')).toBe(
            '/route?id=rt456#comment-cmt123',
        )
    })

    it('addresses a route by its own page, ignoring any route id passed', () => {
        expect(reportContentUrl('route', 'rt456', 'rt999')).toBe(
            '/route?id=rt456',
        )
    })

    it('addresses a beta video as an anchor on its route page', () => {
        expect(reportContentUrl('beta_video', 'vid1', 'rt456')).toBe(
            '/route?id=rt456#beta-vid1',
        )
    })

    it('addresses a profile by the climber page', () => {
        expect(reportContentUrl('profile', 'u1')).toBe('/climber?id=u1')
    })

    it('falls back to a bare anchor when the route id is missing', () => {
        expect(reportContentUrl('rating', 'cmt123', null)).toBe(
            '#comment-cmt123',
        )
        expect(reportContentUrl('rating', 'cmt123')).toBe('#comment-cmt123')
    })
})

describe('REPORT_REASONS', () => {
    it('matches the reason values the reports collection accepts', () => {
        expect(REPORT_REASONS).toEqual([
            'hate_speech',
            'harassment',
            'violence_threat',
            'sexual_content',
            'personal_data',
            'ip_infringement',
            'spam_fraud',
            'other',
        ])
    })

    it('has no duplicates', () => {
        expect(new Set(REPORT_REASONS).size).toBe(REPORT_REASONS.length)
    })
})
