import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('useGlobalSearch', () => {
    it('offers moderation cases to anyone who may open the inbox', () => {
        const source = readFileSync(
            path.resolve(
                import.meta.dirname,
                '../../app/composables/useGlobalSearch.ts',
            ),
            'utf8',
        )
        expect(source).toMatch(
            /key: 'moderation',[\s\S]{0,80}permission: MODERATION_PERMISSIONS/,
        )
        expect(source).toContain('meetsRequirement(source.permission, can)')
    })
})
