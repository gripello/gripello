import { pushDevice } from '~/utils/pushDevice'

export default defineNuxtPlugin(() => {
    const authStore = useAuthStore()
    const { followed } = useFollowedWalls()
    let cachedUserId = authStore.record?.id

    authStore.onChange((_, record) => {
        followed.value = record?.followed_walls ?? []
        if (record?.id === cachedUserId) return
        const previousUserId = cachedUserId
        cachedUserId = record?.id
        // Unregistering deletes the FCM token in the background, so a push turned on right after signing in would store a dying token.
        if (!previousUserId) return
        void pushDevice()
            .unsubscribe()
            .catch(() => {})
    })
})
