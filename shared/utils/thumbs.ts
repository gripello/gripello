export const THUMBS = {
    avatar: '100x100',
    avatarLarge: '320x320',
    logo: '0x200',
    photo: '400x0',
    photoLarge: '1200x0',
    banner: '1600x400',
    bannerLarge: '2400x600',
    cover: '1600x500',
    coverLarge: '2400x750',
} as const

export type ThumbSize = (typeof THUMBS)[keyof typeof THUMBS]

export const THUMB_SETS = {
    avatar: [THUMBS.avatar, THUMBS.avatarLarge],
    photo: [THUMBS.photo, THUMBS.photoLarge],
    banner: [THUMBS.banner, THUMBS.bannerLarge],
    cover: [THUMBS.cover, THUMBS.coverLarge],
} as const satisfies Record<string, readonly ThumbSize[]>

const THUMB_PARAM = /([?&]thumb=)[^&#]*/

export function thumbSrcset(
    url: string | null | undefined,
    thumbs: readonly ThumbSize[],
): string | undefined {
    if (!url || !THUMB_PARAM.test(url)) return undefined
    return thumbs
        .map(
            (thumb) =>
                `${url.replace(THUMB_PARAM, `$1${thumb}`)} ${thumb.split('x')[0]}w`,
        )
        .join(', ')
}
