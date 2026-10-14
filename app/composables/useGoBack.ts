import { parentPath } from '~/utils/navigation'

export const usePageBackTo = () =>
    useState<{ owner: number; to: string } | null>('pageBackTo', () => null)

export const useForcedPop = () => useState('navForcedPop', () => false)

export function useGoBack() {
    const route = useRoute()
    const router = useRouter()
    const pageBackTo = usePageBackTo()
    const forcedPop = useForcedPop()
    const parent = computed(
        () => pageBackTo.value?.to ?? parentPath(route.path),
    )

    function goBack() {
        if (window.history.state?.back) return router.back()
        forcedPop.value = true
        void navigateTo(parent.value ?? '/', { replace: true })
    }

    return { parent, goBack }
}
