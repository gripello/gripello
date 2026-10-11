import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '~/utils/clipboard'

describe('copyText', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('reports whether the text reached the clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        vi.stubGlobal('navigator', { clipboard: { writeText } })
        expect(await copyText('hello')).toBe(true)
        expect(writeText).toHaveBeenCalledWith('hello')

        vi.stubGlobal('navigator', {
            clipboard: {
                writeText: vi.fn().mockRejectedValue(new Error('denied')),
            },
        })
        expect(await copyText('x')).toBe(false)
        vi.stubGlobal('navigator', {})
        expect(await copyText('x')).toBe(false)
    })
})
