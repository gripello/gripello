import type { RouteLocationNormalized } from 'vue-router'
import { settleDialogHistory } from '~/utils/dialogHistory'

export function useDiscardConfirm(hasChanges: () => boolean) {
    const router = useRouter()
    const discardDialogOpen = ref(false)
    let resolvePending: ((confirmed: boolean) => void) | null = null
    let retryLeave: (() => void) | null = null
    let leaveConfirmed = false

    function settleDiscard(confirmed: boolean) {
        const resolve = resolvePending
        const retry = confirmed ? retryLeave : null
        resolvePending = null
        retryLeave = null
        discardDialogOpen.value = false
        resolve?.(confirmed)
        retry?.()
    }

    function confirmDiscard() {
        if (!hasChanges()) return Promise.resolve(true)
        settleDiscard(false)
        discardDialogOpen.value = true
        return new Promise<boolean>((resolve) => {
            resolvePending = resolve
        })
    }

    function leaveGuard(to?: RouteLocationNormalized) {
        if (leaveConfirmed) {
            leaveConfirmed = false
            return true
        }
        const state = window.history.state
        if (
            !hasChanges() ||
            !to ||
            state?.current !== to.fullPath ||
            typeof state.position !== 'number'
        )
            return confirmDiscard()
        const target: number = state.position
        const targetPath = to.fullPath
        window.addEventListener(
            'popstate',
            () => {
                settleDiscard(false)
                retryLeave = async () => {
                    leaveConfirmed = true
                    await settleDialogHistory()
                    const delta =
                        target - Number(window.history.state?.position)
                    if (Number.isInteger(delta) && delta !== 0) router.go(delta)
                    else void router.push(targetPath)
                }
                discardDialogOpen.value = true
            },
            { once: true },
        )
        return false
    }

    watch(discardDialogOpen, (open) => {
        if (!open) settleDiscard(false)
    })

    return { discardDialogOpen, confirmDiscard, settleDiscard, leaveGuard }
}
