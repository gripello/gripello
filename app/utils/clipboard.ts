// Resolves false when the clipboard is unavailable (insecure context, denied permission) instead of throwing.
export async function copyText(text: string) {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}
