const ACHIEVEMENT_CATEGORIES = [
    'progress',
    'volume',
    'style',
    'rhythm',
    'exploration',
    'fresh',
    'community',
    'competition',
] as const

export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number]

export interface AchievementView {
    key: string
    category: AchievementCategory
    icon: string
    tiers: number[]
    value: number
    current: number
    tier: number
    earned: string[]
}

export function nextTier(item: AchievementView): number | null {
    return item.tiers[item.tier] ?? null
}

export function tierStyle(
    item: AchievementView,
): 'locked' | 'earned' | 'complete' {
    if (!item.tier) return 'locked'
    return item.tier === item.tiers.length ? 'complete' : 'earned'
}

export function groupAchievements(items: AchievementView[]) {
    return ACHIEVEMENT_CATEGORIES.map((category) => ({
        category,
        items: items
            .filter((item) => item.category === category)
            .sort((a, b) => b.tier / b.tiers.length - a.tier / a.tiers.length),
    })).filter((group) => group.items.length)
}

export function achievementToast(
    event: { action: string; record: { type?: string; params?: unknown } },
    t: (key: string, params?: Record<string, unknown>) => string,
): string | null {
    if (event.action !== 'create' || event.record.type !== 'achievement_earned')
        return null
    const params = (event.record.params ?? {}) as {
        key?: string
        count?: number
    }
    if (!params.key) return null
    const text = t('achievements.unlocked', {
        name: t(`achievements.names.${params.key}`),
    })
    const more = (params.count ?? 1) - 1
    return more > 0 ? `${text} ${t('achievements.more', { n: more })}` : text
}
