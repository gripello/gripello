import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useClimbers } from '~/composables/useClimbers'

describe('useClimbers', () => {
    it('stays empty while the lookup has no data yet', () => {
        globalThis.__POCKETBASE_CLIENT__ = {}
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('shallowRef', shallowRef)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('useAsyncData', () => ({ data: ref(undefined) }))
        const { byId } = useClimbers(ref(['anna']))
        expect(byId.value.size).toBe(0)
    })

    it('keeps the known names while a new lookup loads', async () => {
        globalThis.__POCKETBASE_CLIENT__ = {}
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('shallowRef', shallowRef)
        vi.stubGlobal('watch', watch)
        const data = ref<unknown>([{ id: 'anna', name: 'Anna', avatar: '' }])
        vi.stubGlobal('useAsyncData', () => ({ data }))
        const { byId } = useClimbers(ref(['anna']))
        data.value = undefined
        await nextTick()
        expect(byId.value.get('anna')?.name).toBe('Anna')
    })
})
