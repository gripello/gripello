import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixtures from '../../backend/testdata/gymContacts.json'
import {
    GYM_CONTACT_KIND_KEYS,
    isValidGymContacts,
} from '#shared/utils/gymContacts'

describe('gymContacts', () => {
    it.each(fixtures.valid)('accepts %j', (value) => {
        expect(isValidGymContacts(value)).toBe(true)
    })

    it.each(fixtures.invalid)('rejects %j', (value) => {
        expect(isValidGymContacts(value)).toBe(false)
    })

    it('matches the roles the api accepts', () => {
        const source = readFileSync('backend/internal/gyms/contacts.go', 'utf8')
        const kinds = source
            .match(/gymContactKinds\s*=\s*\[\]string\{([^}]*)\}/)![1]!
            .match(/"([a-z_]+)"/g)!
            .map((kind) => kind.slice(1, -1))
        expect(kinds).toEqual(GYM_CONTACT_KIND_KEYS)
    })
})
