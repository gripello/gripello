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

import { blobToBase64, saveBlob } from '~/utils/download'

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
