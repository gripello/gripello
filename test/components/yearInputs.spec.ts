import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (file: string) =>
    readFileSync(path.resolve(import.meta.dirname, '../../app', file), 'utf8')

describe('year inputs', () => {
    it.each([
        ['components/competition/Registration.vue', 1],
        ['components/competition/CategoryEditor.vue', 2],
    ])('%s types years instead of stepping through them', (file, count) => {
        const fields = read(file).match(/<UInputNumber[^>]*>/g) ?? []
        const years = fields.filter((field) =>
            field.includes('useGrouping: false'),
        )
        expect(years).toHaveLength(count)
        for (const field of years) {
            expect(field).toContain(':increment="false"')
            expect(field).toContain(':decrement="false"')
        }
    })
})
