import { readFileSync } from 'node:fs'

const source = readFileSync(
    'app/components/analytics/ActivityHeatmap.vue',
    'utf8',
)

describe('AnalyticsActivityHeatmap', () => {
    it('exposes labelled day cells as images so their names are announced', () => {
        expect(source).toMatch(
            /:role="cell\.inRange \? 'img' : undefined"\s+:aria-label="\s+cell\.inRange \? cell\.label : undefined\s+"/,
        )
    })
})
