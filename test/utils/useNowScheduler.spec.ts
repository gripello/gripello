import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sourceFiles(path)
        return /\.(vue|ts)$/.test(name) ? [path] : []
    })
}

it('gives every useNow a scheduler instead of the per-frame default', () => {
    const offenders = sourceFiles(join(ROOT, 'app')).flatMap((path) =>
        [...readFileSync(path, 'utf8').matchAll(/useNow\(([^)]*)/g)]
            .filter((call) => !call[1]!.includes('scheduler'))
            .map(() => relative(ROOT, path)),
    )
    expect(offenders).toEqual([])
})
