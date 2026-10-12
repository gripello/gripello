export function useCoarsePointer() {
    const coarse = ref(false)
    let query: MediaQueryList | undefined
    const update = () => {
        coarse.value = !!query?.matches
    }
    onMounted(() => {
        query = window.matchMedia?.('(pointer: coarse)')
        update()
        query?.addEventListener?.('change', update)
    })
    onBeforeUnmount(() => query?.removeEventListener?.('change', update))
    return coarse
}
