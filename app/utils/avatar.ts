import { THUMBS, type ThumbSize } from '#shared/utils/thumbs'
import { fileUrl } from '~/api/client'

export const AVATAR_COLORS = [
    '#38741c',
    '#38656a',
    '#236628',
    '#0061a4',
    '#673ab7',
    '#00796b',
    '#3f51b5',
    '#c2185b',
    '#006d77',
    '#b45309',
]

export function avatarColor(name: string | null | undefined): string {
    if (!name) return 'var(--ui-primary)'
    const code = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    return AVATAR_COLORS[code % AVATAR_COLORS.length] ?? 'var(--ui-primary)'
}

export function nameInitials(name: string | null | undefined): string {
    if (!name) return '?'
    return name
        .split(' ')
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('')
}

interface NamedUser {
    id?: string
    firstname?: string | null
    name?: string | null
    username?: string | null
    email?: string | null
}

export function displayName(
    user: NamedUser | null | undefined,
    fallback = '',
): string {
    return (
        [user?.firstname, user?.name].filter(Boolean).join(' ') ||
        user?.username ||
        user?.email ||
        fallback
    )
}

export function avatarUrl(
    user: { id?: string; avatar?: string | null } | null | undefined,
    thumb: ThumbSize = THUMBS.avatar,
): string {
    return fileUrl('users', user, user?.avatar, { thumb })
}
