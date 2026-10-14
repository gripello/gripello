import { describe, expect, it } from 'vitest'
import { hasFeature } from '#shared/utils/featureFlags'

describe('hasFeature', () => {
    it('is off unless the gym turned the flag on', () => {
        expect(hasFeature(null, 'beta_links')).toBe(false)
        expect(hasFeature({ features: null }, 'beta_links')).toBe(false)
        expect(hasFeature({ features: {} }, 'beta_links')).toBe(false)
        expect(
            hasFeature({ features: { beta_links: false } }, 'beta_links'),
        ).toBe(false)
        expect(
            hasFeature({ features: { beta_links: true } }, 'beta_links'),
        ).toBe(true)
    })
})
