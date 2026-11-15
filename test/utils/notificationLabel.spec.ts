import { describe, expect, it } from 'vitest'
import {
    notificationLabel,
    notificationLabelKey,
} from '~/utils/notificationLabel'

describe('notificationLabelKey', () => {
    it('names the gym of a filed defect when the hook sent it', () => {
        expect(
            notificationLabelKey({
                type: 'task_defect_filed',
                params: { route: 'Crimp', gym: 'North' },
            }),
        ).toBe('notifications.center.types.task_defect_filed_gym')
    })

    it('keeps the plain text for older notifications and other types', () => {
        expect(
            notificationLabelKey({
                type: 'task_defect_filed',
                params: { route: 'Crimp' },
            }),
        ).toBe('notifications.center.types.task_defect_filed')
        expect(notificationLabelKey({ type: 'task_assigned' })).toBe(
            'notifications.center.types.task_assigned',
        )
    })

    it('names the unlocked achievement and counts the rest', () => {
        const t = (key: string, params?: Record<string, unknown>) =>
            `${key}${params ? JSON.stringify(params) : ''}`
        const te = (key: string) => key !== 'achievements.names.retired'
        expect(
            notificationLabel(
                {
                    type: 'achievement_earned',
                    params: { key: 'sends', count: 1 },
                },
                t,
                te,
            ),
        ).toBe(
            'notifications.center.types.achievement_earned{"name":"achievements.names.sends","more":0}',
        )
        expect(
            notificationLabel(
                {
                    type: 'achievement_earned',
                    params: { key: 'flashes', count: 3 },
                },
                t,
                te,
            ),
        ).toBe(
            'notifications.center.types.achievement_earned_more{"name":"achievements.names.flashes","more":2}',
        )
        expect(
            notificationLabel(
                {
                    type: 'achievement_earned',
                    params: { key: 'retired', count: 2 },
                },
                t,
                te,
            ),
        ).toBe(
            'notifications.center.types.achievement_earned_unnamed{"count":2}',
        )
    })
})
