import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (file: string) =>
    readFileSync(path.resolve(import.meta.dirname, '../../app', file), 'utf8')

describe('readable states', () => {
    it('marks voided routes and inactive entries by surface, not by fading their text', () => {
        for (const file of [
            'components/competition/RouteEditor.vue',
            'components/competition/EntryList.vue',
        ]) {
            const source = read(file)
            expect(source).not.toContain("'opacity-60'")
            expect(source).toMatch(/\? 'bg-muted' : 'bg-default'/)
        }
    })

    it('keeps counts and clocks at full text contrast', () => {
        expect(
            read('components/notifications/ReleaseNotesDialog.vue'),
        ).not.toMatch(/opacity: 0\.\d/)
        expect(read('components/route/BetaPlayer.vue')).not.toContain(
            'flex-1 opacity-90',
        )
        expect(read('pages/platform/index.vue')).not.toMatch(
            /tile\.value\s+\? 'text-highlighted'\s+: 'text-dimmed'/,
        )
    })
})
