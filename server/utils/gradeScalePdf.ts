import { gradeLabels } from '#shared/utils/grades'
import type { GymBand } from '#shared/utils/gradeReference'
import { readableTextOn } from '../../app/utils/color'
import de from '../../i18n/locales/de.json'
import en from '../../i18n/locales/en.json'
import es from '../../i18n/locales/es.json'
import fr from '../../i18n/locales/fr.json'
import nl from '../../i18n/locales/nl.json'

export type Translate = (key: string, params?: Record<string, string>) => string

export interface WheelSpoke {
    label: string
    angle: number
}

export interface WheelArc {
    color: string
    from: number
    to: number
    ring: number
}

export interface GradeScaleContent {
    title: string
    gymName: string
    unitName: string
    footer: string
    logo: Buffer | null
    bands: GymBand[]
    t: Translate
}

const SWEEP = 330
const GRADES_PAST_LAST_BAND = 6
const MARGIN = 48
const INK = '#111827'
const MUTED = '#6B7280'
const SPOKE = '#D1D5DB'

export function gradeWheel(bands: GymBand[]) {
    const font = gradeLabels('font')
    const lastStart = bands
        .slice(0, -1)
        .reduce((sum, band) => sum + band.span, 0)
    const labels = font.slice(0, lastStart + GRADES_PAST_LAST_BAND + 1)
    const step = SWEEP / (labels.length - 1)
    const angleAt = (index: number) => -90 + step * index
    let start = 0
    return {
        spokes: labels.map((label, index): WheelSpoke => ({
            label,
            angle: angleAt(index),
        })),
        arcs: bands.map((band, index): WheelArc => {
            const end = Math.min(start + band.span, labels.length) - 1
            const arc = {
                color: band.color,
                from: angleAt(start) - step / 2,
                to: angleAt(end) + step / 2,
                ring: index % 2,
            }
            start += band.span
            return arc
        }),
    }
}

const polar = (
    cx: number,
    cy: number,
    radius: number,
    degrees: number,
): [number, number] => {
    const radians = (degrees * Math.PI) / 180
    return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)]
}

function ringPath(
    cx: number,
    cy: number,
    inner: number,
    outer: number,
    from: number,
    to: number,
) {
    const large = to - from > 180 ? 1 : 0
    const [x1, y1] = polar(cx, cy, outer, from)
    const [x2, y2] = polar(cx, cy, outer, to)
    const [x3, y3] = polar(cx, cy, inner, to)
    const [x4, y4] = polar(cx, cy, inner, from)
    return `M${x1} ${y1} A${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`
}

function fillBand(doc: PDFKit.PDFDocument, color: string) {
    if (readableTextOn(color) === '#FFFFFF') doc.fill(color)
    else doc.lineWidth(0.6).fillAndStroke(color, '#9CA3AF')
}

export function headerLines({
    unitName,
    gymName,
}: Pick<GradeScaleContent, 'unitName' | 'gymName'>): [string, string] {
    return unitName ? [unitName, gymName] : [gymName, '']
}

function drawHeader(doc: PDFKit.PDFDocument, content: GradeScaleContent) {
    const width = doc.page.width - MARGIN * 2
    let textWidth = width
    if (content.logo) {
        // PDFKit only reads PNG/JPEG; SVG/WebP logos are skipped
        try {
            doc.image(content.logo, MARGIN + width - 150, MARGIN, {
                fit: [150, 64],
                align: 'right',
            })
            textWidth = width - 174
        } catch {}
    }
    doc.font('Sans-Bold')
        .fontSize(34)
        .fillColor(INK)
        .text(content.title.toUpperCase(), MARGIN, MARGIN - 4, {
            width: textWidth,
            characterSpacing: 2,
            lineBreak: false,
        })
    const subtitleOptions = {
        width: textWidth,
        lineBreak: false,
        ellipsis: true,
    }
    const [primary, secondary] = headerLines(content)
    doc.font('Sans-Bold')
        .fontSize(12)
        .fillColor(INK)
        .text(primary, MARGIN, MARGIN + 42, subtitleOptions)
    doc.font('Sans')
        .fillColor(MUTED)
        .text(secondary, MARGIN, MARGIN + 58, subtitleOptions)

    const total = content.bands.reduce((sum, band) => sum + band.span, 0)
    let x = MARGIN
    for (const band of content.bands) {
        const segment = (band.span / total) * width
        doc.rect(x, MARGIN + 86, segment, 5).fill(band.color)
        x += segment
    }
}

function drawWheel(doc: PDFKit.PDFDocument, content: GradeScaleContent) {
    const cx = doc.page.width / 2
    const cy = 470
    const radius = 200
    const ringWidth = 24
    const { spokes, arcs } = gradeWheel(content.bands)

    doc.lineWidth(0.75).strokeColor(SPOKE)
    for (const spoke of spokes) {
        doc.moveTo(cx, cy)
            .lineTo(...polar(cx, cy, radius, spoke.angle))
            .stroke()
    }

    for (const arc of arcs) {
        const outer = radius * 0.86 - arc.ring * ringWidth * 0.55
        doc.path(ringPath(cx, cy, outer - ringWidth, outer, arc.from, arc.to))
        fillBand(doc, arc.color)
    }
    doc.circle(cx, cy, 10).fill(INK)
    doc.circle(cx, cy, 3.5).fill('#FFFFFF')

    doc.font('Sans-Bold').fontSize(12).fillColor(INK)
    for (const spoke of spokes) {
        const [x, y] = polar(cx, cy, radius + 16, spoke.angle)
        doc.text(spoke.label, x - 22, y - 7, {
            width: 44,
            align: 'center',
            lineBreak: false,
        })
    }

    doc.font('Sans-Bold').fontSize(8).fillColor(MUTED)
    const caption = (text: string, angle: number) => {
        const [x, y] = polar(cx, cy, radius + 34, angle)
        doc.text(text.toUpperCase(), x - 40, y - 5, {
            width: 80,
            align: 'center',
            characterSpacing: 1.5,
            lineBreak: false,
        })
    }
    caption(content.t('gradeConversion.easy'), spokes[0]!.angle)
    caption(content.t('gradeConversion.hard'), spokes.at(-1)!.angle)
}

function drawFooter(doc: PDFKit.PDFDocument, content: GradeScaleContent) {
    const y = doc.page.height - 44
    doc.moveTo(MARGIN, y)
        .lineTo(doc.page.width - MARGIN, y)
        .lineWidth(0.5)
        .strokeColor(SPOKE)
        .stroke()
    doc.font('Sans-Bold')
        .fontSize(9)
        .fillColor(MUTED)
        .text(content.footer, MARGIN, y + 12, {
            width: doc.page.width - MARGIN * 2,
            align: 'center',
            characterSpacing: 0.5,
            lineBreak: false,
        })
}

export function drawGradeScalePdf(
    doc: PDFKit.PDFDocument,
    content: GradeScaleContent,
) {
    drawHeader(doc, content)
    drawWheel(doc, content)
    drawFooter(doc, content)
}

const MESSAGES: Record<string, object> = { de, en, es, fr, nl }

export function translator(language: string | null | undefined): Translate {
    const messages = MESSAGES[language ?? ''] ?? en
    return (key, params = {}) => {
        const value = key
            .split('.')
            .reduce<unknown>(
                (node, part) => (node as Record<string, unknown>)?.[part],
                messages,
            )
        return typeof value === 'string'
            ? value.replace(
                  /\{(\w+)\}/g,
                  (match, name) => params[name] ?? match,
              )
            : key
    }
}
