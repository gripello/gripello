import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { buildTooltip } from '~/utils/echarts'

const componentsDir = path.resolve(import.meta.dirname, '../../app/components')
const userText =
    /\.(name|grade|setter|location|creators|votedGradeLabel)\b|\b(locations|grades)\.value\[/

function vueFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return vueFiles(full)
        return entry.name.endsWith('.vue') ? [full] : []
    })
}

function balancedFrom(
    source: string,
    start: number,
    open: string,
    close: string,
) {
    let depth = 0
    let end = start
    do {
        if (source[end] === open) depth++
        if (source[end] === close) depth--
        end++
    } while (depth > 0 && end < source.length)
    return source.slice(start, end)
}

function tooltipBodies(source: string) {
    const bodies: string[] = []
    let start = source.indexOf('itemTooltip(')
    while (start !== -1) {
        const body = balancedFrom(
            source,
            start + 'itemTooltip'.length,
            '(',
            ')',
        )
        bodies.push(body)
        start = source.indexOf('itemTooltip(', start + body.length)
    }
    return bodies
}

function interpolations(body: string) {
    const found: string[] = []
    let start = body.indexOf('${')
    while (start !== -1) {
        const expr = balancedFrom(body, start + 1, '{', '}')
        found.push(expr.slice(1, -1).trim())
        start = body.indexOf('${', start + expr.length)
    }
    return found
}

describe('chart tooltips', () => {
    it('escape every user-entered string they interpolate', () => {
        const unescaped = vueFiles(componentsDir).flatMap((file) =>
            tooltipBodies(readFileSync(file, 'utf8')).flatMap((body) =>
                interpolations(body)
                    .filter(
                        (expr) =>
                            userText.test(expr) &&
                            !expr.startsWith('escapeHtml(') &&
                            !expr.startsWith('t('),
                    )
                    .map((expr) => `${path.basename(file)}: ${expr}`),
            ),
        )
        expect(unescaped).toEqual([])
    })

    it('finds the tooltips it guards', () => {
        const source = readFileSync(
            path.join(componentsDir, 'analytics/RatingChart.vue'),
            'utf8',
        )
        expect(interpolations(tooltipBodies(source)[0]!)).toContain(
            'escapeHtml(route.grade)',
        )
    })

    it('buildTooltip escapes name, value and unit', () => {
        const colors = { tooltipMuted: '#000', tooltipText: '#000' }
        const html = buildTooltip(
            colors as Parameters<typeof buildTooltip>[0],
            '<B>x</B>',
            '<i>1</i>',
            '<u>',
        )
        expect(html).not.toMatch(/<B>|<i>|<u>/)
        expect(html).toContain('&lt;B&gt;x&lt;/B&gt;')
    })
})
