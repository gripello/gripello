import { createError, eventHandler, readBody, setResponseHeaders } from 'h3'
import { getAuthenticatedPb, requirePermission } from '../../utils/pb-server'
import { loadResults } from '../../utils/competitionResults'
import { attachmentHeader } from '../../utils/export'
import {
    standingsTable,
    startListTable,
    type ExportLabels,
    type ExportTable,
} from '#shared/utils/competitionExport'
import type {
    CompetitionCategoryRecord,
    CompetitionEntryRecord,
    CompetitionRecord,
    GymRecord,
} from '../../../types/models'

const KINDS = ['results', 'startlist', 'certificates'] as const
const FORMATS = ['pdf', 'xlsx'] as const

interface CertificateLabels {
    certificate: string
    place: string
}

interface ExportRequest {
    id?: string
    kind?: (typeof KINDS)[number]
    format?: (typeof FORMATS)[number]
    locale?: string
    labels?: ExportLabels & CertificateLabels & { title: string }
}

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 40
const ACCENT = '#38741c'
const MUTED = '#6b7280'
const ZEBRA = '#f3f6ef'
const MIME = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export default eventHandler(async (event) => {
    const body = ((await readBody(event)) ?? {}) as ExportRequest
    const { id, kind, format = 'pdf', labels } = body
    if (
        !id ||
        !labels ||
        !KINDS.includes(kind!) ||
        !FORMATS.includes(format) ||
        (kind === 'certificates' && format !== 'pdf')
    ) {
        throw createError({ statusCode: 400, statusMessage: 'Bad request.' })
    }
    const locale = safeLocale(body.locale)
    const competition = await getAuthenticatedPb(event)
        .collection('competitions')
        .getOne<CompetitionRecord>(id, { requestKey: null })
        .catch(() => {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' })
        })
    const pb = await requirePermission(
        event,
        'manage_competitions',
        competition.gym ?? '',
    )
    const [results, gym] = await Promise.all([
        loadResults(pb, competition, true),
        pb
            .collection('gyms')
            .getOne<GymRecord>(competition.gym ?? '', { requestKey: null })
            .catch(() => null),
    ])
    setResponseHeaders(event, {
        'Content-Type': MIME[format],
        'Content-Disposition': attachmentHeader(
            `${competition.name}-${kind}.${format}`,
        ),
    })

    const subtitle = [dateRange(competition, locale), gym?.name]
        .filter(Boolean)
        .join(' · ')

    if (kind === 'certificates') {
        const logo = gym?.sign_image
            ? await fetchImage(pb.files.getURL(gym, gym.sign_image))
            : null
        const rows = results.categories.flatMap((category) =>
            category.rows.map((row) => ({ category: category.name, row })),
        )
        return renderPdf([A4[1], A4[0]], (doc) => {
            if (!rows.length) {
                drawHeader(doc, competition.name, labels.certificate, subtitle)
            }
            rows.forEach(({ category, row }, index) => {
                if (index) doc.addPage()
                drawCertificate(doc, {
                    logo,
                    title: labels.certificate,
                    competition: competition.name,
                    name: row.name || labels.anonymous,
                    rank: row.rank,
                    place: labels.place
                        .replace('{rank}', String(row.rank))
                        .replace('{category}', category),
                    footer: subtitle,
                })
            })
        })
    }

    const table =
        kind === 'results'
            ? standingsTable(results.categories, results.format, labels)
            : await loadStartList(
                  pb,
                  id,
                  labels,
                  !!competition.requires_payment,
              )

    if (format === 'xlsx') return renderXlsx(table, labels.title)
    return renderPdf(A4, (doc) => {
        drawHeader(doc, competition.name, labels.title, subtitle)
        drawTable(doc, table)
    })
})

async function loadStartList(
    pb: Awaited<ReturnType<typeof requirePermission>>,
    id: string,
    labels: ExportLabels,
    withPaid: boolean,
) {
    const filter = pb.filter('competition = {:id}', { id })
    const [entries, categories] = await Promise.all([
        pb
            .collection('competition_entries')
            .getFullList<CompetitionEntryRecord>({ filter, requestKey: null }),
        pb
            .collection('competition_categories')
            .getFullList<CompetitionCategoryRecord>({
                filter,
                sort: 'sort,name',
                requestKey: null,
            }),
    ])
    return startListTable(entries, categories, labels, withPaid)
}

async function renderXlsx(table: ExportTable, title: string) {
    const { Workbook } = await import('@cj-tech-master/excelts')
    const workbook = new Workbook()
    const sections = table.sections.length
        ? table.sections
        : [{ title, rows: [] }]
    const usedNames = new Set<string>()
    for (const section of sections) {
        const sheet = workbook.addWorksheet(sheetName(section.title, usedNames))
        sheet.columns = table.headers.map((header, index) => ({
            header,
            width: index === table.nameColumn ? 32 : 12,
        }))
        sheet.getRow(1).font = { bold: true }
        sheet.views = [{ state: 'frozen', ySplit: 1 }]
        for (const row of section.rows) sheet.addRow(row)
    }
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

function sheetName(title: string, used: Set<string>) {
    const base = title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 28) || 'Sheet'
    let name = base
    for (let index = 2; used.has(name.toLowerCase()); index++) {
        name = `${base} ${index}`
    }
    used.add(name.toLowerCase())
    return name
}

type Pdf = InstanceType<typeof import('pdfkit')>

async function renderPdf(
    size: [number, number],
    draw: (doc: Pdf) => void,
): Promise<Buffer> {
    const { default: PDFDocument } = await import('pdfkit')
    const fonts = useStorage('assets:server')
    const [regular, bold] = await Promise.all([
        fonts.getItemRaw<Buffer>('fonts/Roboto-Regular.ttf'),
        fonts.getItemRaw<Buffer>('fonts/Roboto-Bold.ttf'),
    ])
    if (!regular || !bold) throw new Error('PDF fonts missing')
    const doc = new PDFDocument({ size, margin: MARGIN, bufferPages: true })
    doc.registerFont('Sans', Buffer.from(regular))
    doc.registerFont('Sans-Bold', Buffer.from(bold))
    doc.font('Sans')
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const done = new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)
    })
    draw(doc)
    const { start, count } = doc.bufferedPageRange()
    if (count > 1) {
        for (let page = start; page < start + count; page++) {
            doc.switchToPage(page)
            doc.font('Sans')
                .fontSize(8)
                .fillColor(MUTED)
                .text(
                    `${page + 1} / ${count}`,
                    MARGIN,
                    doc.page.height - MARGIN + 12,
                    {
                        width: doc.page.width - MARGIN * 2,
                        align: 'right',
                        lineBreak: false,
                    },
                )
        }
    }
    doc.end()
    return done
}

function drawHeader(doc: Pdf, title: string, kind: string, subtitle: string) {
    const width = doc.page.width - MARGIN * 2
    doc.font('Sans-Bold')
        .fontSize(9)
        .fillColor(ACCENT)
        .text(kind.toUpperCase(), MARGIN, MARGIN, {
            width,
            characterSpacing: 1,
        })
    doc.font('Sans-Bold')
        .fontSize(22)
        .fillColor('#111827')
        .text(title, MARGIN, doc.y + 2, { width })
    if (subtitle) {
        doc.font('Sans')
            .fontSize(10)
            .fillColor(MUTED)
            .text(subtitle, MARGIN, doc.y + 2, { width })
    }
    const lineY = doc.y + 10
    doc.moveTo(MARGIN, lineY)
        .lineTo(MARGIN + width, lineY)
        .lineWidth(2)
        .strokeColor(ACCENT)
        .stroke()
    doc.y = lineY + 18
}

const ROW_HEIGHT = 20

function drawTable(doc: Pdf, table: ExportTable) {
    const width = A4[0] - MARGIN * 2
    const cellPadding = 12
    const textWidth = (text: string | number, bold: boolean) =>
        doc
            .font(bold ? 'Sans-Bold' : 'Sans')
            .fontSize(10)
            .widthOfString(String(text)) + cellPadding
    const widths = table.headers.map((header, index) =>
        Math.max(
            textWidth(header, true),
            ...table.sections.flatMap((section) =>
                section.rows.map((row) => textWidth(row[index] ?? '', false)),
            ),
        ),
    )
    const others = widths.reduce(
        (sum, value, index) => (index === table.nameColumn ? sum : sum + value),
        0,
    )
    widths[table.nameColumn] = Math.max(width - others, 80)
    const bottom = A4[1] - MARGIN - 10
    const drawRow = (
        cells: (string | number)[],
        options: { header?: boolean; zebra?: boolean; podium?: boolean },
    ) => {
        const y = doc.y
        if (options.header || options.zebra) {
            doc.rect(MARGIN, y, width, ROW_HEIGHT).fill(
                options.header ? ACCENT : ZEBRA,
            )
        }
        let x = MARGIN
        doc.font(options.header || options.podium ? 'Sans-Bold' : 'Sans')
            .fontSize(10)
            .fillColor(options.header ? '#ffffff' : '#111827')
        cells.forEach((cell, index) => {
            const isName = index === table.nameColumn
            doc.text(String(cell), x + 6, y + 5, {
                width: widths[index]! - 12,
                align: isName ? 'left' : index === 0 ? 'left' : 'right',
                lineBreak: false,
                ellipsis: true,
            })
            x += widths[index]!
        })
        doc.y = y + ROW_HEIGHT
    }
    const header = () => drawRow(table.headers, { header: true })

    for (const section of table.sections) {
        if (doc.y + ROW_HEIGHT * 3 + 24 > bottom) doc.addPage()
        doc.font('Sans-Bold')
            .fontSize(13)
            .fillColor('#111827')
            .text(section.title, MARGIN, doc.y, { width })
        doc.y += 4
        header()
        section.rows.forEach((row, index) => {
            if (doc.y + ROW_HEIGHT > bottom) {
                doc.addPage()
                header()
            }
            drawRow(row, {
                zebra: index % 2 === 1,
                podium: table.rankColumn && Number(row[0]) <= 3,
            })
        })
        doc.y += 18
    }
}

function drawCertificate(
    doc: Pdf,
    content: {
        logo: Buffer | null
        title: string
        competition: string
        name: string
        rank: number
        place: string
        footer: string
    },
) {
    const [width, height] = [A4[1], A4[0]]
    const inner = width - MARGIN * 4
    doc.lineWidth(6)
        .strokeColor(ACCENT)
        .rect(MARGIN / 2, MARGIN / 2, width - MARGIN, height - MARGIN)
        .stroke()
    doc.lineWidth(1)
        .rect(MARGIN, MARGIN, width - MARGIN * 2, height - MARGIN * 2)
        .stroke()
    let y = content.logo ? MARGIN * 2 : MARGIN * 3.5
    if (content.logo) {
        try {
            doc.image(content.logo, width / 2 - 60, y, {
                fit: [120, 60],
                align: 'center',
            })
            y += 72
        } catch {}
    }
    const centered = (
        text: string,
        font: string,
        size: number,
        color: string,
        gap: number,
    ) => {
        doc.font(font)
            .fontSize(size)
            .fillColor(color)
            .text(text, MARGIN * 2, y, { width: inner, align: 'center' })
        y = doc.y + gap
    }
    centered(content.title.toUpperCase(), 'Sans-Bold', 40, ACCENT, 6)
    centered(content.competition, 'Sans', 18, MUTED, 30)
    centered(content.name, 'Sans-Bold', 36, '#111827', 18)
    const badge = 64
    doc.circle(width / 2, y + badge / 2, badge / 2).fill(ACCENT)
    doc.font('Sans-Bold')
        .fontSize(28)
        .fillColor('#ffffff')
        .text(String(content.rank), width / 2 - badge / 2, y + 16, {
            width: badge,
            align: 'center',
        })
    y += badge + 14
    centered(content.place, 'Sans', 20, '#111827', 0)
    doc.font('Sans')
        .fontSize(11)
        .fillColor(MUTED)
        .text(content.footer, MARGIN * 2, height - MARGIN * 2 - 6, {
            width: inner,
            align: 'center',
        })
}

function dateRange(competition: CompetitionRecord, locale: string) {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long' })
        .formatRange(
            new Date(competition.starts_at.replace(' ', 'T')),
            new Date(competition.ends_at.replace(' ', 'T')),
        )
        .replace(/\s/g, ' ')
}

function safeLocale(locale: string | undefined) {
    try {
        return (
            Intl.DateTimeFormat.supportedLocalesOf([String(locale)])[0] ?? 'en'
        )
    } catch {
        return 'en'
    }
}

async function fetchImage(url: string) {
    try {
        const response = await fetch(url)
        return response.ok ? Buffer.from(await response.arrayBuffer()) : null
    } catch {
        return null
    }
}
