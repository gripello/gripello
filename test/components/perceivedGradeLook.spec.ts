import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')

function vueFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return vueFiles(path)
        return name.endsWith('.vue') ? [path] : []
    })
}

const showsPerceivedGrade = vueFiles(join(ROOT, 'app')).filter((path) =>
    /t\('ratings\.perceived'\)/.test(readFileSync(path, 'utf8')),
)

describe('the perceived grade looks the same everywhere', () => {
    it('is shown in the route header and on review cards', () => {
        expect(
            showsPerceivedGrade.map((path) => relative(ROOT, path)).sort(),
        ).toEqual([
            'app/components/comments/Card.vue',
            'app/components/route/Hero.vue',
        ])
    })

    it('always uses the shared icon', () => {
        for (const path of showsPerceivedGrade)
            expect(readFileSync(path, 'utf8')).toContain('PERCEIVED_GRADE_ICON')
    })
})
