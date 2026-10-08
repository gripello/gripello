import { settleDialogHistory, trackDialogPath } from '~/utils/dialogHistory'

export default defineNuxtPlugin(() => {
    const router = useRouter()
    trackDialogPath(() => router.currentRoute.value.fullPath)
    router.beforeResolve(() => settleDialogHistory())
})
