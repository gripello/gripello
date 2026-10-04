export function useFollowedWalls() {
    const pb = usePocketbase()
    const followed = useState<string[]>(
        'followed-walls',
        () => pb.authStore.record?.followed_walls ?? [],
    )

    const isFollowing = (wallId: string) => followed.value.includes(wallId)

    async function setFollowing(wallId: string, follow: boolean) {
        const userId = pb.authStore.record?.id
        if (!userId) return
        const previous = followed.value
        followed.value = follow
            ? [...previous, wallId]
            : previous.filter((id) => id !== wallId)
        try {
            const updated = await pb.collection('users').update(userId, {
                [follow ? 'followed_walls+' : 'followed_walls-']: wallId,
            })
            pb.authStore.save(pb.authStore.token, updated)
        } catch (err) {
            followed.value = previous
            throw err
        }
    }

    return { followed, isFollowing, setFollowing }
}
