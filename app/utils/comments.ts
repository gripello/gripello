export type RealtimeCommentPlacement = 'prepend' | 'append' | 'refetch'

export function realtimeCommentPlacement(
    sortOrder: string,
    alreadyListed: boolean,
    hasMore: boolean,
): RealtimeCommentPlacement {
    // A listed record means a refetch raced the insert; the API counts concurrently, so its total may predate it.
    if (alreadyListed) return 'refetch'
    if (sortOrder === 'newest') return 'prepend'
    if (sortOrder === 'oldest' && !hasMore) return 'append'
    return 'refetch'
}
