import { pushDeviceUser, setPushDeviceUser } from '~/utils/push'
import { pushDevice } from '~/utils/pushDevice'
import { stopFollowingFcmToken } from '~/composables/usePushOffer'

export default defineNuxtPlugin(() => {
    const authStore = useAuthStore()
    const { followed } = useFollowedWalls()
    let cachedUserId = authStore.record?.id
    if (cachedUserId) setPushDeviceUser(cachedUserId)

    authStore.onChange((_, record) => {
        followed.value = record?.followed_walls ?? []
        if (record?.id === cachedUserId) return
        cachedUserId = record?.id
        stopFollowingFcmToken()
        // A session can end without a sign-out (expired cookie), so the device remembers whose push it carries.
        const deviceUser = pushDeviceUser()
        setPushDeviceUser(record?.id)
        // Unregistering deletes the FCM token in the background, so only do it when the device really changes hands.
        if (!deviceUser || deviceUser === record?.id) return
        void pushDevice()
            .unsubscribe()
            .catch(() => {})
    })
})
