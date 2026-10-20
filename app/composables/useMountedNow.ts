import { useIntervalFn } from '@vueuse/core'

// SSR and hydration render without a clock; it starts after mount.
export function useMountedNow(intervalMs: number) {
    const now = ref<Date | null>(null)
    const { resume } = useIntervalFn(
        () => (now.value = new Date()),
        intervalMs,
        { immediate: false },
    )
    onMounted(() => {
        now.value = new Date()
        resume()
    })
    return now
}
