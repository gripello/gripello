import { describe, expect, it } from 'vitest'
import {
    isLegacyGymPath,
    legacyGymRedirect,
} from '#shared/utils/legacyGymPaths'

describe('legacyGymRedirect', () => {
    it('prefixes the old tenant paths with the gym slug', () => {
        expect(legacyGymRedirect('/routes', '', 'gym-a')).toBe('/gym-a/routes')
        expect(legacyGymRedirect('/map', '?location=x', 'gym-a')).toBe(
            '/gym-a/map?location=x',
        )
        expect(legacyGymRedirect('/manage/tasks', '', 'gym-a')).toBe(
            '/gym-a/manage/tasks',
        )
        expect(legacyGymRedirect('/competitions/c1/tv', '', 'gym-a')).toBe(
            '/gym-a/competitions/c1/tv',
        )
        expect(legacyGymRedirect('/admin/users', '', 'gym-a')).toBe(
            '/gym-a/admin/users',
        )
    })

    it('folds in the old admin to manage moves', () => {
        expect(legacyGymRedirect('/admin/routes', '?page=2', 'gym-a')).toBe(
            '/gym-a/manage/routes?page=2',
        )
        expect(legacyGymRedirect('/admin/analytics', '', 'gym-a')).toBe(
            '/gym-a/manage/analytics',
        )
        expect(legacyGymRedirect('/admin/activity', '', 'gym-a')).toBe(
            '/account/activity',
        )
        expect(legacyGymRedirect('/admin/activity', '', '')).toBe(
            '/account/activity',
        )
    })

    it('sends to the landing page without a known gym', () => {
        expect(legacyGymRedirect('/manage/routes', '?x=1', '')).toBe('/')
    })

    it('leaves every other path alone', () => {
        for (const path of [
            '/',
            '/route',
            '/routesx',
            '/logbook',
            '/account',
            '/gym-a/routes',
            '/scan',
        ]) {
            expect(isLegacyGymPath(path), path).toBe(false)
            expect(legacyGymRedirect(path, '', 'gym-a')).toBeNull()
        }
    })
})
