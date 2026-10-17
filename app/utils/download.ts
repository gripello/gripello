import { isNativeApp } from './native'

export async function saveBlob(blob: Blob, filename: string) {
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
    await Share.share({ title: filename, files: [uri] })
}

export function blobToBase64(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
    })
}
