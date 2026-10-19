import { followWall, unfollowWall } from '~/api/account'
import { useAuthState } from '~/api/auth'

let followsAuthRecord = false

export function useFollowedWalls() {
    const auth = useAuthState()
    const followed = useState<string[]>(
        'followed-walls',
        () => auth.currentUser()?.followed_walls ?? [],
    )
    // user:<id> events update the auth record, also for walls followed on another device
    if (import.meta.client && !followsAuthRecord) {
        followsAuthRecord = true
        useAuthStore().onChange((_, record) => {
            followed.value = record?.followed_walls ?? []
        })
    }

    const isFollowing = (wallId: string) => followed.value.includes(wallId)

    async function setFollowing(wallId: string, follow: boolean) {
        const userId = auth.currentUserId()
        if (!userId) return
        const toggle = (on: boolean) => {
            const others = followed.value.filter((id) => id !== wallId)
            followed.value = on ? [...others, wallId] : others
        }
        const wasFollowing = isFollowing(wallId)
        toggle(follow)
        try {
            await (follow ? followWall : unfollowWall)(wallId)
        } catch (err) {
            toggle(wasFollowing)
            throw err
        }
    }

    return { followed, isFollowing, setFollowing }
}
