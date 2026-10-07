import type { AuthRecord } from 'pocketbase'

export function useAuthRecord() {
    const pb = usePocketbase()
    return useState<AuthRecord>('auth-record', () => pb.authStore.record)
}
