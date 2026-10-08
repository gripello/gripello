import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { GYM_AMENITY_KEYS } from '#shared/utils/gymAmenities'

it('matches the amenity values of the gym info migration', () => {
    const migration = readFileSync(
        'pocketbase/pb_migrations/1792800001_gym_info.js',
        'utf8',
    )
    const values = migration
        .match(/const AMENITIES = \[([^\]]*)\]/)![1]!
        .match(/'([a-z_]+)'/g)!
    expect(values.map((v) => v.slice(1, -1))).toEqual(GYM_AMENITY_KEYS)
})
