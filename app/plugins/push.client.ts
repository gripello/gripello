export default defineNuxtPlugin(() => {
    const authStore = useAuthStore()
    const { followed } = useFollowedWalls()
    let cachedUserId = authStore.record?.id

    authStore.onChange((_, record) => {
        followed.value = record?.followed_walls ?? []
        if (record?.id === cachedUserId) return
        cachedUserId = record?.id
        void navigator.serviceWorker
            ?.getRegistration()
            .then((registration) => registration?.pushManager.getSubscription())
            .then((subscription) => subscription?.unsubscribe())
            .catch(() => {})
    })
})
