import { describe, expect, it } from 'vitest'
import { hasFeature } from '#shared/utils/featureFlags'

describe('hasFeature', () => {
    it('is off unless the gym turned the flag on', () => {
        expect(hasFeature(null, 'beta_videos')).toBe(false)
        expect(hasFeature({ features: null }, 'beta_videos')).toBe(false)
        expect(hasFeature({ features: {} }, 'beta_videos')).toBe(false)
        expect(
            hasFeature({ features: { beta_videos: false } }, 'beta_videos'),
        ).toBe(false)
        expect(
            hasFeature({ features: { beta_videos: true } }, 'beta_videos'),
        ).toBe(true)
    })
})
