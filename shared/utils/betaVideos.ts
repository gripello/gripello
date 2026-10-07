// Mirrored in pocketbase/hooks/beta_videos.go.
const BETA_VIDEO_HOSTS = {
    'youtube.com': 'YouTube',
    'instagram.com': 'Instagram',
    'tiktok.com': 'TikTok',
} as const

export const BETA_VIDEO_MAX_BYTES = 30 * 1024 * 1024
export const BETA_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']

export function betaVideoPlatform(link: string): string | null {
    let parsed: URL
    try {
        parsed = new URL(link)
    } catch {
        return null
    }
    if (parsed.protocol !== 'https:') return null
    const host = parsed.hostname
        .toLowerCase()
        .replace(/^www\./, '')
        .replace(/^(m|vm)\./, '')
    const platform =
        BETA_VIDEO_HOSTS[host as keyof typeof BETA_VIDEO_HOSTS] ?? null
    if (platform === 'YouTube' && !parsed.pathname.startsWith('/shorts/'))
        return null
    return platform
}

export function videoClock(seconds: number): string {
    const whole = Number.isFinite(seconds)
        ? Math.max(0, Math.floor(seconds))
        : 0
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const PLATFORM_ICONS: Record<string, string> = {
    TikTok: 'i-simple-icons-tiktok',
    Instagram: 'i-simple-icons-instagram',
    YouTube: 'i-simple-icons-youtube',
}

export function betaPlatformIcon(link: string, fallback: string): string {
    return PLATFORM_ICONS[betaVideoPlatform(link) ?? ''] ?? fallback
}

export const BETA_LINK_RATIO = 9 / 16
