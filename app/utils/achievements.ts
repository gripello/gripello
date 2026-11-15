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
