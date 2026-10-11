import { useAuthState } from '~/api/auth'

export default defineNuxtPlugin(() => {
    const { ensureLoaded } = usePermissions()
    useAuthState().onAuthChange(() => ensureLoaded())
})
