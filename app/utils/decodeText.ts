// Excel saves CSV in the Windows code page, which is not valid UTF-8 once it holds umlauts.
export function decodeText(bytes: ArrayBuffer): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return new TextDecoder('windows-1252').decode(bytes)
    }
}
