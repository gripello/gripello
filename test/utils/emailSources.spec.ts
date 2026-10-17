import { describe, expect, it } from 'vitest'
import type { EmailSource } from '~/api/platform'
import { blocklistVerdict, emailSourceSummary } from '~/utils/emailSources'

const t = (key: string, named?: Record<string, unknown>) =>
    `${key}${named ? JSON.stringify(named) : ''}`

const source: EmailSource = {
    id: 'mailchecker',
    name: 'FGRibreau/mailchecker',
    homepage: 'https://github.com/FGRibreau/mailchecker',
    license: 'MIT',
    enabled: true,
    synced_at: null,
    attempted_at: null,
    domain_count: 0,
    last_error: '',
}

describe('emailSourceSummary', () => {
    it('says when a source never synced', () => {
        expect(emailSourceSummary(source, t, 'en')).toBe(
            'platform.settings.blocklists.neverSynced',
        )
    })

    it('shows the count and the sync time', () => {
        const summary = emailSourceSummary(
            {
                ...source,
                synced_at: new Date().toISOString(),
                domain_count: 56512,
            },
            t,
            'en',
        )
        expect(summary).toContain('"n":"56,512"')
        expect(summary).toContain('syncedAgo')
        expect(summary).toContain('time.justNow')
    })
})

describe('blocklistVerdict', () => {
    const sources = [source]

    it('names the source that blocks an address', () => {
        expect(
            blocklistVerdict(
                {
                    email: {
                        blocked: true,
                        rule: 'source',
                        match: 'mailchecker',
                    },
                    name: null,
                },
                sources,
            ),
        ).toEqual({
            blocked: true,
            key: 'platform.settings.blocklists.verdict.source',
            match: 'FGRibreau/mailchecker',
        })
    })

    it('tells own entries, exceptions and free addresses apart', () => {
        const verdict = (rule: '' | 'allowed' | 'blocked') =>
            blocklistVerdict(
                {
                    email: { blocked: rule === 'blocked', rule, match: 'x' },
                    name: null,
                },
                sources,
            )?.key
        expect(verdict('blocked')).toMatch(/verdict\.blocked$/)
        expect(verdict('allowed')).toMatch(/verdict\.exception$/)
        expect(verdict('')).toMatch(/verdict\.allowed$/)
    })

    it('reports reserved names with the matching term', () => {
        expect(
            blocklistVerdict(
                { email: null, name: { protected: true, match: 'gripello' } },
                sources,
            ),
        ).toEqual({
            blocked: true,
            key: 'platform.settings.blocklists.verdict.reserved',
            match: 'gripello',
        })
        expect(
            blocklistVerdict({ email: null, name: null }, sources),
        ).toBeNull()
    })
})
