import { describe, expect, it } from 'vitest'
import { safeRedirect, staffLandingPath } from '~/utils/nav'

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

describe('staffLandingPath', () => {
    it('opens route management of the first membership gym', () => {
        expect(
            staffLandingPath([
                { expand: { gym: { slug: 'gym-a', active: true } } },
                { expand: { gym: { slug: 'gym-b', active: true } } },
            ]),
        ).toBe('/gym-a/manage/routes')
    })

    it('skips inactive gyms', () => {
        expect(
            staffLandingPath([
                { expand: { gym: { slug: 'gym-a', active: false } } },
                { expand: { gym: { slug: 'gym-b', active: true } } },
            ]),
        ).toBe('/gym-b/manage/routes')
    })

    it('falls back to the landing page', () => {
        expect(staffLandingPath([])).toBe('/')
    })
})
