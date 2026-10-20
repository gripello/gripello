import { readFileSync } from 'node:fs'

describe('backups page', () => {
    it('keeps the long restore command from widening the page on phones', () => {
        const source = readFileSync('app/pages/platform/backups.vue', 'utf8')
        expect(source).toContain(
            'grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]',
        )
        expect(source).toMatch(
            /flex min-w-0 flex-col gap-3">\s+<LayoutPanel :title="t\('platform\.backups\.schedule'\)"/,
        )
    })

    it('shows the backup hours in UTC until the browser knows its zone', () => {
        const source = readFileSync('app/pages/platform/backups.vue', 'utf8')
        expect(source).toContain(
            "computed(() => (hydrated.value ? undefined : 'UTC'))",
        )
        expect(source).toContain(
            'backupHourOptions(locale.value, viewerZone.value)',
        )
        expect(source).toContain('(${zoneLabel})')
    })
})
