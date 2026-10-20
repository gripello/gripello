import { staffExitPath } from '~/utils/navigation'

export const useStaffReturnTo = () =>
    useState<string | null>('staffReturnTo', () => null)

export function useStaffExit() {
    const returnTo = useStaffReturnTo()
    const { slug } = useGym()
    return computed(() => staffExitPath(returnTo.value, slug.value))
}
