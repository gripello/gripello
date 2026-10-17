import type { BlocklistCheckResult, EmailSource } from '~/api/platform'
import { timeAgo } from '#shared/utils/formatting'

type Translate = (
    key: string,
    named?: Record<string, unknown>,
    plural?: number,
) => string

// "9,892 domains · synced 3 hours ago", or "Never synced" before the first download.
export function emailSourceSummary(
    source: EmailSource,
    t: Translate,
    locale: string,
) {
    if (!source.synced_at) return t('platform.settings.blocklists.neverSynced')
    const count = t(
        'platform.settings.blocklists.domainCount',
        { n: source.domain_count.toLocaleString(locale) },
        source.domain_count,
    )
    const synced = t('platform.settings.blocklists.syncedAgo', {
        ago: timeAgo(source.synced_at, t, locale),
    })
    return `${count} · ${synced}`
}

export interface BlocklistVerdict {
    blocked: boolean
    key: string
    match: string
}

// Turns a check answer into the badge the tester shows: blocked or allowed, and which rule decided.
export function blocklistVerdict(
    result: BlocklistCheckResult,
    sources: EmailSource[],
): BlocklistVerdict | null {
    const prefix = 'platform.settings.blocklists.verdict'
    if (result.email) {
        const { rule, match } = result.email
        if (rule === 'source')
            return {
                blocked: true,
                key: `${prefix}.source`,
                match: sources.find((s) => s.id === match)?.name ?? match,
            }
        if (rule === 'blocked')
            return { blocked: true, key: `${prefix}.blocked`, match }
        if (rule === 'allowed')
            return { blocked: false, key: `${prefix}.exception`, match }
        return { blocked: false, key: `${prefix}.allowed`, match: '' }
    }
    if (result.name)
        return result.name.protected
            ? {
                  blocked: true,
                  key: `${prefix}.reserved`,
                  match: result.name.match,
              }
            : { blocked: false, key: `${prefix}.allowed`, match: '' }
    return null
}
