import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(import.meta.dirname, '../../app/pages/[gym]/route.vue'),
    'utf8',
)

describe('gym route page', () => {
    it('shows "removed" only for a 404 and keeps the shown route when a refresh fails', () => {
        expect(source).toMatch(
            /useOfflineData\(\s+routeKey,\s+keepShownOnError\(routeKey,/,
        )
        expect(source).toContain('await nullIfNotFound(')
    })

    it('offers a retry when reviews or defects fail to load instead of hiding them', () => {
        expect(source).toMatch(
            /keepShownOnError\(ratingsKey,[\s\S]+?\{ default: \(\) => \[\] \}/,
        )
        expect(source).toMatch(
            /keepShownOnError\(defectsKey,[\s\S]+?\{ default: \(\) => \[\] \}/,
        )
        expect(source).not.toMatch(/\.catch\(\(err\) =>/)
        expect(source).toMatch(
            /<LayoutLoadError\s+v-if="ratingsError"\s+@retry="routeRatings\.refresh\(\)"/,
        )
        expect(source).toMatch(
            /<LayoutLoadError\s+v-if="defectsError"[\s\S]+?@retry="getOpenDefects\(\)"/,
        )
    })
})
