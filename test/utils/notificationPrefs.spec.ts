import { describe, expect, it } from 'vitest'
import {
    isTopicEnabled,
    visibleTopics,
    withTopic,
} from '~/utils/notificationPrefs'

describe('visibleTopics', () => {
    const topics = [
        { key: 'new_routes' },
        { key: 'tasks', permission: 'manage_tasks' },
        { key: 'reports', permission: 'manage_reports' },
    ]

    it('shows climber topics to everyone', () => {
        expect(visibleTopics(topics, new Set()).map((t) => t.key)).toEqual([
            'new_routes',
        ])
    })

    it('shows staff topics only with the matching permission', () => {
        expect(
            visibleTopics(topics, new Set(['manage_reports'])).map(
                (t) => t.key,
            ),
        ).toEqual(['new_routes', 'reports'])
    })
})

describe('notification prefs', () => {
    it('treats unset topics as enabled', () => {
        expect(isTopicEnabled(null, 'push', 'tasks')).toBe(true)
        expect(isTopicEnabled({ push: {} }, 'push', 'tasks')).toBe(true)
    })

    it('stores only disabled topics', () => {
        const off = withTopic({}, 'push', 'tasks', false)
        expect(off).toEqual({ push: { tasks: false } })
        expect(isTopicEnabled(off, 'push', 'tasks')).toBe(false)
        expect(withTopic(off, 'push', 'tasks', true)).toEqual({ push: {} })
    })

    it('keeps other topics and channels untouched', () => {
        const prefs = {
            push: { new_routes: false },
            email: { tasks: false },
        } as Parameters<typeof withTopic>[0]
        expect(withTopic(prefs, 'push', 'tasks', false)).toEqual({
            push: { new_routes: false, tasks: false },
            email: { tasks: false },
        })
    })
})
