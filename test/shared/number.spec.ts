import { describe, expect, it } from 'vitest'
import {
    formatBytes,
    formatCompact,
    formatNumber,
    formatPercent,
} from '#shared/utils/number'

describe('formatBytes', () => {
    it('picks a binary unit with one decimal above bytes', () => {
        expect(formatBytes(512, 'en')).toBe('512 byte')
        expect(formatBytes(1536, 'en')).toBe('1.5 kB')
        expect(formatBytes(12.34 * 1024 ** 2, 'en')).toBe('12.3 MB')
        expect(formatBytes(5 * 1024 ** 3, 'en')).toBe('5 GB')
    })
})

describe('formatPercent', () => {
    it('adds a decimal below one percent', () => {
        expect(formatPercent(0.1234, 'en')).toBe('12.3%')
        expect(formatPercent(0.0012, 'en')).toBe('0.12%')
        expect(formatPercent(0, 'en')).toBe('0%')
    })
})

describe('formatCompact', () => {
    it('shortens large counts', () => {
        expect(formatCompact(1530, 'en')).toBe('1.5K')
        expect(formatCompact(42, 'en')).toBe('42')
    })
})

describe('formatNumber', () => {
    it('shows a dash for missing values', () => {
        expect(formatNumber(null, 'en')).toBe('—')
        expect(formatNumber(1.25, 'en', 1)).toBe('1.3')
    })
})
