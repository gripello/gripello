import { REPORT_REASONS } from '#shared/utils/reports'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('REPORT_REASONS', () => {
    it('matches the ReportReason enum of the API', () => {
        const spec = readFileSync('api/moderation.yaml', 'utf8')
        const enumLine =
            /ReportReason:\s+type: string\s+enum: \[([^\]]+)\]/.exec(spec)
        expect(enumLine).not.toBeNull()
        expect(REPORT_REASONS).toEqual(
            enumLine![1]!.split(',').map((value) => value.trim()),
        )
    })

    it('has no duplicates', () => {
        expect(new Set(REPORT_REASONS).size).toBe(REPORT_REASONS.length)
    })
})
