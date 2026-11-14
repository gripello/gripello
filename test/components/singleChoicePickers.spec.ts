import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (file: string) =>
    readFileSync(path.resolve(import.meta.dirname, '../../app', file), 'utf8')

describe('single-choice pickers', () => {
    it.each([
        ['components/manage/WallReset.vue', '<OptionGrid', 'reset-in"'],
        [
            'pages/[gym]/manage/inventory.vue',
            '<SegmentedControl',
            'inventory-location',
        ],
        [
            'components/analytics/ActivityHeatmap.vue',
            '<SegmentedControl',
            'analytics-heatmap-year',
        ],
        [
            'components/notifications/ReleaseNotesDialog.vue',
            '<OptionGrid',
            'release-notes-filter',
        ],
    ])('%s uses the shared radio component', (file, component, testId) => {
        const source = read(file)
        expect(source).toContain(component)
        expect(source).toContain(testId)
        expect(source).not.toMatch(
            new RegExp(`aria-pressed[^>]*${testId}|${testId}[^>]*aria-pressed`),
        )
    })
})
