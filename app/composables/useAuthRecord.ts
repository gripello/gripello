import type { AuthRecord } from '~/composables/authStore'
import { useAuthState } from '~/api/auth'

export function useAuthRecord() {
    const { currentUser } = useAuthState()
    return useState<AuthRecord>('auth-record', () => currentUser())
}
