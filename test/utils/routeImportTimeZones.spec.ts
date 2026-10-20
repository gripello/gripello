import { afterEach, describe, expect, it } from 'vitest'
import { Workbook } from '@cj-tech-master/excelts'
import {
    parseImportDate,
    parseImportDateTime,
    tableFromXlsx,
} from '~/utils/routeImport'

const originalTimeZone = process.env.TZ

describe.each(['Europe/Berlin', 'Pacific/Auckland', 'America/Los_Angeles'])(
    'XLSX dates in %s',
    (timeZone) => {
        afterEach(() => {
            process.env.TZ = originalTimeZone
        })

        async function sheetCell(value: Date) {
            process.env.TZ = timeZone
            const workbook = new Workbook()
            const sheet = workbook.addWorksheet('Routes')
            sheet.addRow(['Set on'])
            sheet.addRow([value])
            const buffer = await workbook.xlsx.writeBuffer()
            const table = await tableFromXlsx(buffer as ArrayBuffer)
            return table.rows[0]!['Set on']
        }

        it('keeps the day of a date cell', async () => {
            const cell = await sheetCell(new Date(Date.UTC(2026, 2, 4)))
            expect(parseImportDate(cell, 'de')).toBe('2026-03-04')
        })

        it('reads a date-time cell as local wall time', async () => {
            const cell = await sheetCell(new Date(Date.UTC(2026, 2, 4, 23, 30)))
            expect(parseImportDateTime(cell, 'de')).toBe(
                new Date(2026, 2, 4, 23, 30).toISOString(),
            )
        })

        it('keeps the local day of a Date value', () => {
            process.env.TZ = timeZone
            expect(parseImportDate(new Date(2026, 2, 4), 'de')).toBe(
                '2026-03-04',
            )
        })
    },
)
