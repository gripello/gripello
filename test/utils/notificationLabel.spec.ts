import { describe, expect, it } from 'vitest'
import { notificationLabelKey } from '~/utils/notificationLabel'

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
})
