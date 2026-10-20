import { useEventListener } from '@vueuse/core'

export function useCoarsePointer() {
    const coarse = ref(false)
    const query = shallowRef<MediaQueryList>()
    const update = () => {
        coarse.value = !!query.value?.matches
    }
    useEventListener(query, 'change', update)
    onMounted(() => {
        query.value = window.matchMedia?.('(pointer: coarse)')
        update()
    })
    return coarse
}
