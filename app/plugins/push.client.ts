import { pushDevice } from '~/utils/pushDevice'

export default defineNuxtPlugin(() => {
    const authStore = useAuthStore()
    const { followed } = useFollowedWalls()
    let cachedUserId = authStore.record?.id

    authStore.onChange((_, record) => {
        followed.value = record?.followed_walls ?? []
        if (record?.id === cachedUserId) return
        cachedUserId = record?.id
        void pushDevice()
            .unsubscribe()
            .catch(() => {})
    })
})
