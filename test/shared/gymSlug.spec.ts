import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixtures from '../../pocketbase/testdata/gymSlug.json'
import {
    RESERVED_GYM_SLUGS,
    isValidGymSlug,
    slugifyGymName,
} from '#shared/utils/gymSlug'

describe('gymSlug', () => {
    it('reserves the fixture list', () => {
        expect(RESERVED_GYM_SLUGS).toEqual(fixtures.reserved)
    })

    it.each(fixtures.slugify)('slugifies %j to %j', (name, slug) => {
        expect(slugifyGymName(name!)).toBe(slug)
    })

    it.each(fixtures.valid)('accepts %j', (slug) => {
        expect(isValidGymSlug(slug)).toBe(true)
    })

    it.each(fixtures.invalid)('rejects %j', (slug) => {
        expect(isValidGymSlug(slug)).toBe(false)
    })

    it('reserves every top-level page name', () => {
        const pages = readdirSync('app/pages')
            .map((entry) => entry.replace(/\.vue$/, ''))
            .filter((name) => name !== 'index' && !name.startsWith('['))
        expect(
            pages.filter((name) => !RESERVED_GYM_SLUGS.includes(name)),
        ).toEqual([])
    })
})
