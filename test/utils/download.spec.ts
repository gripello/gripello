import { afterEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ value: false }))
const writeFile = vi.hoisted(() =>
    vi.fn(async () => ({ uri: 'file:///cache/a.txt' })),
)
const share = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock('~/utils/native', () => ({ isNativeApp: () => native.value }))
vi.mock('@capacitor/filesystem', () => ({
    Directory: { Cache: 'CACHE' },
    Filesystem: { writeFile },
}))
vi.mock('@capacitor/share', () => ({ Share: { share } }))

import {
    attachmentName,
    blobToBase64,
    safeFilename,
    saveBlob,
    saveDownload,
} from '~/utils/download'

describe('saveBlob', () => {
    afterEach(() => {
        native.value = false
        vi.restoreAllMocks()
        writeFile.mockClear()
        share.mockClear()
    })

    it('downloads through a link in the browser', async () => {
        const click = vi
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {})
        await saveBlob(new Blob(['x']), 'a.txt')
        expect(click).toHaveBeenCalledOnce()
        expect(share).not.toHaveBeenCalled()
    })

    it('writes the file to the cache and opens the share sheet in the app', async () => {
        native.value = true
        await saveBlob(new Blob(['hi']), 'a.txt')
        expect(writeFile).toHaveBeenCalledWith({
            path: 'a.txt',
            data: 'aGk=',
            directory: 'CACHE',
        })
        expect(share).toHaveBeenCalledWith({
            title: 'a.txt',
            files: ['file:///cache/a.txt'],
        })
    })
})

describe('blobToBase64', () => {
    it('returns the bare base64 payload', async () => {
        expect(await blobToBase64(new Blob(['hi']))).toBe('aGk=')
    })
})

describe('saveDownload', () => {
    afterEach(() => {
        native.value = false
        vi.unstubAllGlobals()
        share.mockClear()
    })

    it('saves a fetched file like an export, so the app shows the share sheet', async () => {
        native.value = true
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response('pdf', {
                        headers: {
                            'Content-Disposition':
                                'attachment; filename="Halle-Skala.pdf"; filename*=UTF-8\'\'Halle%20Skala.pdf',
                        },
                    }),
            ),
        )
        await saveDownload('/api/ui/grade-scale?gym=g1', 'fallback.pdf')
        expect(share).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Halle Skala.pdf' }),
        )
    })

    it('fails instead of saving an error page', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('', { status: 404 })),
        )
        await expect(saveDownload('/x', 'x.pdf')).rejects.toThrow('404')
    })
})

describe('attachmentName', () => {
    it('prefers the UTF-8 name and falls back to the plain one', () => {
        expect(
            attachmentName(
                'attachment; filename="a.pdf"; filename*=UTF-8\'\'K%C3%B6ln.pdf',
            ),
        ).toBe('Köln.pdf')
        expect(attachmentName('attachment; filename="a.pdf"')).toBe('a.pdf')
        expect(attachmentName(null)).toBeNull()
    })
})

describe('download filenames', () => {
    afterEach(() => {
        native.value = false
        share.mockReset()
        share.mockImplementation(async () => ({}))
        writeFile.mockClear()
    })

    it('replaces characters that break paths or are invalid on Windows', () => {
        expect(safeFilename('Cup 1/2: Finale?.pdf')).toBe(
            'Cup 1-2- Finale-.pdf',
        )
        expect(safeFilename(' ..//.. ')).toBe('download')
        expect(safeFilename('Klettern in Köln.pdf')).toBe(
            'Klettern in Köln.pdf',
        )
    })

    it('writes a competition named with a slash into the cache root in the app', async () => {
        native.value = true
        await saveBlob(new Blob(['x']), 'Cup 1/2-Results.pdf')
        expect(writeFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'Cup 1-2-Results.pdf' }),
        )
    })

    it('treats closing the share sheet as done, not as an error', async () => {
        native.value = true
        share.mockRejectedValueOnce(new Error('Share canceled'))
        await expect(
            saveBlob(new Blob(['x']), 'a.pdf'),
        ).resolves.toBeUndefined()
        share.mockRejectedValueOnce(new Error('No app can handle this'))
        await expect(saveBlob(new Blob(['x']), 'a.pdf')).rejects.toThrow()
    })
})
