import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function vueFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return vueFiles(path)
        return entry.name.endsWith('.vue') ? [path] : []
    })
}

describe('scoped styles', () => {
    it('never use :global(), which Vue reduces to the bare global selector', () => {
        const offenders = vueFiles('app').filter((file) =>
            [
                ...readFileSync(file, 'utf8').matchAll(
                    /<style[^>]*scoped[^>]*>([\s\S]*?)<\/style>/g,
                ),
            ].some(([, css]) => css!.includes(':global(')),
        )
        expect(offenders).toEqual([])
    })
})
