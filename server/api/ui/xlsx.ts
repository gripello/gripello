import { eventHandler, createError } from 'h3'
import { requirePermission } from '../../utils/pb-server'
import {
    resolveRouteIds,
    resolveExportColumns,
    resolveApplicationUrl,
    resolveExportGymId,
    fetchRecordsByIds,
} from '../../utils/export'
import { normalizeHexColor } from '#shared/utils/color'

const QR_PX = 240 // generated QR bitmap size
const QR_CELL_SIZE = 72 // rendered size inside the sheet, in pixels
const QR_ROW_HEIGHT = 58 // points — keeps the image inside its row
const QR_COLUMN_WIDTH = 12
const MIN_COLUMN_WIDTH = 8
const MAX_COLUMN_WIDTH = 60

export default eventHandler(async (event) => {
    const { Workbook } = await import('@cj-tech-master/excelts')

    const gymId = await resolveExportGymId(event)
    const pb = await requirePermission(event, 'manage_routes', gymId)
    const res = event.node.res

    const ids = await resolveRouteIds(event)
    if (ids.length === 0) {
        throw createError({
            statusCode: 400,
            statusMessage: 'No IDs provided.',
        })
    }

    const columns = await resolveExportColumns(event)
    if (columns.length === 0) {
        throw createError({
            statusCode: 400,
            statusMessage: 'No columns selected.',
        })
    }

    try {
        const uniqueIds = Array.from(new Set(ids))
        const records = await fetchRecordsByIds(pb, {
            collection: 'routes',
            ids: uniqueIds,
            field: 'id',
            expand: 'location,wall',
            requestKey: 'export-xlsx-routes',
            gym: gymId,
        })

        const recordById = new Map(records.map((record) => [record.id, record]))
        const climbingRoutes = uniqueIds
            .map((id) => recordById.get(id))
            .filter((route) => route !== undefined)

        const qrIndex = columns.findIndex((column) => column.key === 'qr')
        const colorIndex = columns.findIndex((column) => column.key === 'color')

        const QRCode = (await import('qrcode')).default
        const applicationUrl = resolveApplicationUrl(event)

        const workbook = new Workbook()
        const sheetName = await resolveExportLabel(event, 'sheet', 'Routes')
        const worksheet = workbook.addWorksheet(
            sheetName.replace(/[[\]:*?/\\]/g, '').slice(0, 31) || 'Routes',
        )

        worksheet.columns = columns.map((column) => ({
            header: column.header,
            key: column.key,
        }))

        const widths = columns.map((column) => column.header.length)

        for (const climbingRoute of climbingRoutes) {
            const row = worksheet.addRow(
                Object.fromEntries(
                    columns
                        .filter((column) => column.value)
                        .map((column) => [
                            column.key,
                            column.value!(climbingRoute),
                        ]),
                ),
            )

            columns.forEach((column, index) => {
                if (!column.value) {
                    return
                }
                const cell = row.getCell(index + 1)
                widths[index] = Math.max(
                    widths[index] ?? 0,
                    String(cell.value ?? '').length,
                )
            })

            if (colorIndex !== -1) {
                row.getCell(colorIndex + 1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: {
                        argb: `FF${normalizeHexColor(climbingRoute.color).slice(1)}`,
                    },
                }
            }

            if (qrIndex !== -1) {
                const buffer = await QRCode.toBuffer(
                    `${applicationUrl}/route?id=${climbingRoute.id}`,
                    {
                        errorCorrectionLevel: 'M',
                        width: QR_PX,
                        margin: 1,
                    },
                )
                const imageId = workbook.addImage({ buffer, extension: 'png' })
                worksheet.addImage(imageId, {
                    tl: { col: qrIndex, row: row.number - 1 },
                    ext: { width: QR_CELL_SIZE, height: QR_CELL_SIZE },
                })
                row.height = QR_ROW_HEIGHT
            }
        }

        columns.forEach((column, index) => {
            worksheet.getColumn(index + 1).width =
                column.key === 'qr'
                    ? QR_COLUMN_WIDTH
                    : Math.min(
                          Math.max((widths[index] ?? 0) + 2, MIN_COLUMN_WIDTH),
                          MAX_COLUMN_WIDTH,
                      )
        })

        worksheet.autoFilter = {
            from: { row: 1, col: 1 },
            to: { row: climbingRoutes.length + 1, col: columns.length },
        }

        const buffer = await workbook.xlsx.writeBuffer()

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="climbing-routes-${Date.now()}.xlsx"`,
        )
        res.end(buffer)
    } catch (error) {
        console.error(error)
        throw createError({ statusCode: 500, statusMessage: 'Server error' })
    }
})
