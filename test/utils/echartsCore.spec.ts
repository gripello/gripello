import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ComponentModel } from 'echarts/core'
import { initEchart } from '~/utils/echartsCore'

const appDir = path.resolve(import.meta.dirname, '../../app')

const chartSources = readdirSync(path.join(appDir, 'components'), {
    recursive: true,
    encoding: 'utf8',
})
    .filter((file) => file.endsWith('Chart.vue'))
    .map((file) => readFileSync(path.join(appDir, 'components', file), 'utf8'))
    .concat(readFileSync(path.join(appDir, 'utils/echarts.ts'), 'utf8'))
    .join('\n')

const isRegistered = (mainType: string, subType?: string) =>
    subType
        ? !!ComponentModel.getClass(mainType, subType)
        : ComponentModel.getClassesByMainType(mainType).length > 0

const nonSeriesTypes = new Set([
    'category',
    'value',
    'time',
    'log',
    'dashed',
    'solid',
    'dotted',
    'none',
    'shadow',
    'cross',
    'inside',
    'slider',
    'continuous',
    'piecewise',
])

const componentKeys = [
    'axisPointer',
    'brush',
    'calendar',
    'dataZoom',
    'dataset',
    'geo',
    'graphic',
    'grid',
    'legend',
    'markArea',
    'markLine',
    'markPoint',
    'parallel',
    'polar',
    'radar',
    'singleAxis',
    'timeline',
    'title',
    'toolbox',
    'tooltip',
    'visualMap',
]

describe('echartsCore registrations', () => {
    it('registers every series type the chart components use', () => {
        const seriesTypes = [
            ...chartSources.matchAll(/\btype:\s*'(\w+)'/g),
        ].map(([, type]) => type!)
        const used = [...new Set(seriesTypes)].filter(
            (type) => !nonSeriesTypes.has(type),
        )

        expect(used).toContain('bar')
        for (const type of used) {
            expect(isRegistered('series', type), type).toBe(true)
        }
    })

    it('registers every option component the chart components use', () => {
        const used = componentKeys.filter((key) =>
            new RegExp(`\\b${key}\\s*:(?!\\s*[A-Z])`).test(chartSources),
        )

        expect(used).toContain('tooltip')
        for (const key of used) {
            expect(isRegistered(key), key).toBe(true)
        }
        expect(isRegistered('dataZoom', 'inside')).toBe(true)
        expect(isRegistered('dataZoom', 'slider')).toBe(true)
        expect(isRegistered('visualMap', 'continuous')).toBe(true)
    })

    it('renders with the svg renderer without missing-import errors', () => {
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {})
        const chart = initEchart(null, null, {
            renderer: 'svg',
            ssr: true,
            width: 400,
            height: 300,
        })
        chart.setOption({
            aria: { enabled: true },
            tooltip: {},
            legend: {},
            grid: {},
            visualMap: { min: 0, max: 1, show: false },
            dataZoom: [{ type: 'inside' }, { type: 'slider' }],
            xAxis: { type: 'category', data: ['a', 'b'] },
            yAxis: { type: 'value' },
            series: [
                {
                    type: 'bar',
                    data: [1, 2],
                    markLine: { data: [{ yAxis: 1 }] },
                },
                { type: 'line', data: [1, 2] },
                { type: 'scatter', data: [[0, 1]] },
            ],
        })
        const svg = chart.renderToSVGString()
        chart.dispose()

        expect(svg).toContain('<svg')
        expect(consoleError).not.toHaveBeenCalled()
        consoleError.mockRestore()
    })
})
