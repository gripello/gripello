export default defineNuxtPlugin(() => {
    const pb = usePocketbase()
    const { followed } = useFollowedWalls()
    let cachedUserId = pb.authStore.record?.id

    pb.authStore.onChange((_, record) => {
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
