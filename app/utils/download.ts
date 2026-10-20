import { isNativeApp } from './native'

export async function saveBlob(blob: Blob, name: string) {
    const filename = safeFilename(name)
    if (isNativeApp()) return shareFile(blob, filename)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function saveDownload(url: string, fallbackName: string) {
    const response = await fetch(url)
    if (!response.ok)
        throw new Error(`Download failed with status ${response.status}`)
    const filename =
        attachmentName(response.headers.get('Content-Disposition')) ??
        fallbackName
    await saveBlob(await response.blob(), filename)
}

// A slash in a gym or competition name would make the app write into a missing directory.
export function safeFilename(name: string) {
    const cleaned = name
        .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.-]+|[\s-]+$/g, '')
    return cleaned || 'download'
}

export function attachmentName(disposition: string | null) {
    const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    if (encoded) return decodeURIComponent(encoded)
    return disposition?.match(/filename="([^"]+)"/i)?.[1] ?? null
}

// The WebView can't save blob: URLs, so the app writes the file to its cache and offers the share sheet.
// ponytail: base64 holds the whole file in memory; stream through Filesystem.appendFile if exports grow large.
async function shareFile(blob: Blob, filename: string) {
    const [{ Directory, Filesystem }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'),
        import('@capacitor/share'),
    ])
    const { uri } = await Filesystem.writeFile({
        path: filename,
        data: await blobToBase64(blob),
        directory: Directory.Cache,
    })
    await Share.share({ title: filename, files: [uri] }).catch((error) => {
        if (!isShareCancel(error)) throw error
    })
}

export function blobToBase64(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
    })
}

const isShareCancel = (error: unknown) =>
    /cancel/i.test((error as { message?: string } | null)?.message ?? '')
