export interface ChartColors {
    labelColor: string
    gridColor: string
    tooltipBg: string
    tooltipText: string
    tooltipMuted: string
    tooltipBorder: string
}

export interface ChartPalette {
    categorical: string[]
    sequential: string[]
    positive: string
    negative: string
    neutral: string
}

const LIGHT_PALETTE: ChartPalette = {
    categorical: [
        '#2a78d6',
        '#eb6834',
        '#1baf7a',
        '#eda100',
        '#e87ba4',
        '#008300',
        '#4a3aa7',
        '#e34948',
    ],
    sequential: ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
    positive: '#2a78d6',
    negative: '#e34948',
    neutral: '#a8a7a2',
}

const DARK_PALETTE: ChartPalette = {
    categorical: [
        '#3987e5',
        '#d95926',
        '#199e70',
        '#c98500',
        '#d55181',
        '#008300',
        '#9085e9',
        '#e66767',
    ],
    sequential: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6'],
    positive: '#3987e5',
    negative: '#e66767',
    neutral: '#6b6a66',
}

export function chartPalette(isDark: boolean): ChartPalette {
    return isDark ? DARK_PALETTE : LIGHT_PALETTE
}

export const gridBase = {
    left: '0%',
    right: '1%',
    bottom: '0%',
    top: '8%',
    containLabel: true,
}

export function readChartColors(isDark: boolean): ChartColors {
    const onSurface = isDark ? '221, 221, 221' : '23, 23, 23'
    const surface = isDark ? '22, 27, 34' : '255, 255, 255'

    return {
        labelColor: `rgba(${onSurface}, 0.7)`,
        gridColor: `rgba(${onSurface}, 0.08)`,
        tooltipBg: `rgba(${surface}, 0.96)`,
        tooltipText: `rgba(${onSurface}, 0.9)`,
        tooltipMuted: `rgba(${onSurface}, 0.65)`,
        tooltipBorder: `rgba(${onSurface}, 0.1)`,
    }
}

export function buildTooltip(
    colors: ChartColors,
    name: string,
    value: string | number,
    unit: string,
) {
    return `<span style="font-size:13px;color:${colors.tooltipMuted}">${name}</span><br/>
            <span style="font-weight:600;font-size:15px;color:${colors.tooltipText}">${value}</span>
            <span style="font-size:12px;color:${colors.tooltipMuted};margin-left:4px">${unit}</span>`
}

export function tooltipBase(colors: ChartColors) {
    return {
        trigger: 'axis',
        axisPointer: { type: 'none' },
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
        extraCssText:
            'border-radius:8px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.12)',
    }
}

export function makeXAxis(colors: ChartColors, labels: string[]) {
    return {
        type: 'category',
        data: labels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
            color: colors.labelColor,
            fontSize: 11,
            rotate: labels.length > 9 ? 35 : 0,
            margin: 10,
        },
    }
}

export function yAxisBase(colors: ChartColors) {
    return {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: colors.labelColor, fontSize: 11 },
        splitLine: { lineStyle: { color: colors.gridColor, type: 'dashed' } },
    }
}

export function formatMonthLabel(monthKey: string, locale?: string) {
    const [year, month] = monthKey.split('-').map(Number)
    if (!year || !month) return monthKey
    return new Intl.DateTimeFormat(locale, {
        month: 'short',
        year: 'numeric',
    }).format(new Date(year, month - 1, 1))
}

export function escapeHtml(value: string) {
    return value.replace(
        /[&<>"']/g,
        (char) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[char]!,
    )
}

export function itemTooltip(
    colors: ChartColors,
    formatter: (params: any) => string,
) {
    return { ...tooltipBase(colors), trigger: 'item', formatter }
}
