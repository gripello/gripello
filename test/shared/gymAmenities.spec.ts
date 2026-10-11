import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { GYM_AMENITY_KEYS } from '#shared/utils/gymAmenities'

it('matches the amenity values the api accepts', () => {
    const service = readFileSync('backend/internal/gyms/service.go', 'utf8')
    const values = service
        .match(/var gymAmenities = \[\]string\{([^}]*)\}/)![1]!
        .match(/"([a-z_]+)"/g)!
    expect(values.map((v) => v.slice(1, -1))).toEqual(GYM_AMENITY_KEYS)
})
