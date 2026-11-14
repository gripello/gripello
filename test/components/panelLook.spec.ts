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

    it('frame boxes and tables with LayoutPanel; only item cards and layout parts draw their own', () => {
        const ownLook = new Set([
            'app/components/comments/Card.vue',
            'app/components/route/Card.vue',
            'app/components/route/BetaTile.vue',
            'app/components/logbook/SessionCard.vue',
            'app/components/competition/Card.vue',
            'app/components/competition/CategoryEditor.vue',
            'app/components/task/Card.vue',
            'app/components/platform/SettingsStatus.vue',
            'app/pages/platform/logs.vue',
            'app/components/filter/Bar.vue',
            'app/pages/climber.vue',
        ])
        const offenders = vueFiles('app')
            .filter(
                (file) =>
                    !file.startsWith('app/components/layout/') &&
                    !ownLook.has(file),
            )
            .filter((file) =>
                /class="[^"]*rounded-(lg|xl) bg-default\b[^"]*\bring\b/.test(
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
