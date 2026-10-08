export function useHydrated() {
    const nuxtApp = useNuxtApp()
    const hydrated = ref(false)
    onMounted(() => {
        if (!nuxtApp.isHydrating) hydrated.value = true
        else
            nuxtApp.hooks.hookOnce('app:suspense:resolve', () => {
                hydrated.value = true
            })
    })
    return hydrated
}
