import { describe, expect, it } from 'vitest'
import { loginRedirect, safeRedirect, staffLandingPath } from '~/utils/nav'

describe('safeRedirect', () => {
    it('keeps same-origin paths', () => {
        expect(safeRedirect('/logbook')).toBe('/logbook')
        expect(safeRedirect('/route?id=abc')).toBe('/route?id=abc')
    })

    it('drops anything that could leave the site', () => {
        expect(safeRedirect('//evil.test')).toBeNull()
        expect(safeRedirect('/\\evil.test')).toBeNull()
        expect(safeRedirect('https://evil.test')).toBeNull()
        expect(safeRedirect(['/logbook'])).toBeNull()
        expect(safeRedirect(undefined)).toBeNull()
    })
})

describe('loginRedirect', () => {
    it('restores the hash the browser kept across the sign-in redirect', () => {
        expect(loginRedirect('/account/settings?tab=privacy', '#push')).toBe(
            '/account/settings?tab=privacy#push',
        )
    })

    it('keeps a hash that is already part of the redirect', () => {
        expect(loginRedirect('/route?id=a#reviews', '#other')).toBe(
            '/route?id=a#reviews',
        )
        expect(loginRedirect('/logbook', '')).toBe('/logbook')
    })

    it('never attaches a hash to an unsafe redirect', () => {
        expect(loginRedirect('//evil.test', '#x')).toBeNull()
    })
})

describe('staffLandingPath', () => {
    it('opens route management of the first membership gym', () => {
        expect(
            staffLandingPath([
                { gym: { slug: 'gym-a', active: true } },
                { gym: { slug: 'gym-b', active: true } },
            ]),
        ).toBe('/gym-a/manage/routes')
    })

    it('skips inactive gyms', () => {
        expect(
            staffLandingPath([
                { gym: { slug: 'gym-a', active: false } },
                { gym: { slug: 'gym-b', active: true } },
            ]),
        ).toBe('/gym-b/manage/routes')
    })

    it('falls back to the landing page', () => {
        expect(staffLandingPath([])).toBe('/')
    })
})
