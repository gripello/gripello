import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(import.meta.dirname, '../../app/pages/logbook.vue'),
    'utf8',
)

describe('logbook page', () => {
    it('names the route in the delete confirmation', () => {
        expect(source).toContain(
            ':title="t(\'ticks.deleteTitle\', { name: deleteRouteName })"',
        )
        expect(source).toMatch(
            /function askDelete\(tick: TickRecord\) \{\s+deleteTarget\.value = tick\s+deleteRouteName\.value =\s+tick\.expand\?\.route\?\.name \|\| tick\.route_name \|\| t\('ticks\.removedRoute'\)/,
        )
        expect(source).toContain('@delete="askDelete"')
    })
})
