import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function vueFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return vueFiles(path)
        return entry.name.endsWith('.vue') ? [path] : []
    })
}

describe('boxed sections', () => {
    it('use LayoutPanel instead of UPageCard, UCard or .surface-card', () => {
        const offenders = vueFiles('app').filter((file) =>
            /<UPageCard\b|<UCard\b|surface-card/.test(
                readFileSync(file, 'utf8'),
            ),
        )
        expect(offenders).toEqual([])
    })

    it('never hand-roll a boxed section', () => {
        const offenders = vueFiles('app').filter((file) =>
            /<section\b[^>]*class="[^"]*rounded-lg bg-default[^"]*\bring\b/.test(
                readFileSync(file, 'utf8'),
            ),
        )
        expect(offenders).toEqual([])
    })

    it('render lists through LayoutListGroup, not a divide-y card container', () => {
        const offenders = vueFiles('app').filter((file) =>
            /container: LIST|const LIST =/.test(readFileSync(file, 'utf8')),
        )
        expect(offenders).toEqual([])
    })

    it('tint danger panels with ring-error/40!', () => {
        const offenders = vueFiles('app').filter((file) =>
            /ring-error\/(?!40!)\d+!/.test(readFileSync(file, 'utf8')),
        )
        expect(offenders).toEqual([])
    })
})
