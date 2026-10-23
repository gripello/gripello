import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
    MODERATION_PERMISSIONS,
    PERMISSIONS,
    meetsRequirement,
} from '#shared/utils/permissions'

function seededPermissions(): string[] {
    const names = new Set<string>()
    for (const file of globSync(
        'backend/internal/platform/db/migrations/*.sql',
    ).sort()) {
        const up = readFileSync(file, 'utf8').split('-- +goose Down')[0]!
        for (const [, values] of up.matchAll(
            /INSERT INTO permissions\b[^;]*?VALUES([^;]*);/gi,
        )) {
            for (const [, name] of values!.matchAll(
                /\(\s*'[^']*'\s*,\s*'([a-z_]+)'/g,
            ))
                names.add(name!)
        }
        for (const [, name] of up.matchAll(
            /DELETE FROM permissions WHERE name\s*=\s*'([a-z_]+)'/gi,
        ))
            names.delete(name!)
    }
    return [...names].sort()
}

describe('permissions', () => {
    it('match the names the migrations seed', () => {
        expect([...PERMISSIONS].sort()).toEqual(seededPermissions())
    })
})

describe('meetsRequirement', () => {
    const can = (permission: string) => permission === 'manage_reports'

    it('accepts one permission or any of several', () => {
        expect(meetsRequirement('manage_reports', can)).toBe(true)
        expect(meetsRequirement('manage_comments', can)).toBe(false)
        expect(meetsRequirement(MODERATION_PERMISSIONS, can)).toBe(true)
        expect(meetsRequirement(['manage_routes'], can)).toBe(false)
    })
})
