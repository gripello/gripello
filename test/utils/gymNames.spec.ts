import { describe, expect, it } from 'vitest'
import {
    gymSubtitle,
    gymTitle,
    landingSections,
    pageTitle,
} from '~/utils/gymNames'

describe('gym names', () => {
    it('leads with the venue and falls back to the gym name', () => {
        expect(gymTitle({ name: 'DAV', unit_name: 'Kletterhalle Nord' })).toBe(
            'Kletterhalle Nord',
        )
        expect(
            gymSubtitle({ name: 'DAV', unit_name: 'Kletterhalle Nord' }),
        ).toBe('DAV')
        expect(gymTitle({ name: 'DAV', unit_name: '' })).toBe('DAV')
        expect(gymSubtitle({ name: 'DAV', unit_name: '' })).toBe('')
        expect(gymSubtitle({ name: 'DAV', unit_name: 'DAV' })).toBe('')
    })
})

describe('landingSections', () => {
    const gyms = ['a', 'b', 'c'].map((slug) => ({ slug }))
    const slugsOf = (sections: ReturnType<typeof landingSections>) =>
        sections.map((section) => [
            section.key,
            section.gyms.map((gym) => gym.slug),
        ])

    it('shows every gym once: mine, then recent, then the rest', () => {
        expect(slugsOf(landingSections(gyms, ['b'], ['b', 'c', 'x']))).toEqual([
            ['my-gyms', ['b']],
            ['recent', ['c']],
            ['all-gyms', ['a']],
        ])
    })

    it('hides empty sections', () => {
        expect(slugsOf(landingSections([{ slug: 'a' }], [], ['a']))).toEqual([
            ['recent', ['a']],
        ])
    })
})

describe('pageTitle', () => {
    it('prefixes the gym and appends the app name once', () => {
        expect(pageTitle('Boulderwerk', 'Routes')).toBe(
            'Boulderwerk · Routes - Gripello',
        )
        expect(pageTitle('', 'Logbook')).toBe('Logbook - Gripello')
        expect(pageTitle('', '')).toBe('Gripello')
        expect(pageTitle('', 'Delete your Gripello account')).toBe(
            'Delete your Gripello account',
        )
    })
})
