import { describe, expect, it } from 'vitest'
import {
    achievementToast,
    groupAchievements,
    nextTier,
    tierStyle,
    type AchievementView,
} from '~/utils/achievements'

const item = (
    key: string,
    category: AchievementView['category'],
    tiers: number[],
    tier: number,
): AchievementView => ({
    key,
    category,
    icon: 'i-lucide-flag',
    tiers,
    value: 0,
    current: 0,
    tier,
    earned: [],
})

describe('achievements', () => {
    it('names the next tier and the tier style', () => {
        const sends = item('sends', 'volume', [1, 10, 50], 1)
        expect(nextTier(sends)).toBe(10)
        expect(tierStyle(sends)).toBe('earned')
        expect(tierStyle(item('pyramid', 'progress', [1], 1))).toBe('complete')
        expect(tierStyle(item('walls', 'exploration', [3], 0))).toBe('locked')
        expect(nextTier(item('pyramid', 'progress', [1], 1))).toBeNull()
    })

    it('groups by category in a fixed order, most complete first', () => {
        const groups = groupAchievements([
            item('reviews', 'community', [1, 10], 0),
            item('sends', 'volume', [1, 10], 1),
            item('sessions', 'volume', [10, 25], 2),
        ])
        expect(groups.map((group) => group.category)).toEqual([
            'volume',
            'community',
        ])
        expect(groups[0]!.items.map((entry) => entry.key)).toEqual([
            'sessions',
            'sends',
        ])
    })

    it('celebrates newly created achievement notifications only', () => {
        const t = (key: string, params?: Record<string, unknown>) =>
            `${key}${params ? JSON.stringify(params) : ''}`
        const record = {
            type: 'achievement_earned',
            params: { key: 'sends', count: 3 },
        }
        expect(achievementToast({ action: 'create', record }, t)).toBe(
            'achievements.unlocked{"name":"achievements.names.sends"} achievements.more{"n":2}',
        )
        expect(achievementToast({ action: 'update', record }, t)).toBeNull()
        expect(
            achievementToast(
                { action: 'create', record: { type: 'new_follower' } },
                t,
            ),
        ).toBeNull()
    })
})
