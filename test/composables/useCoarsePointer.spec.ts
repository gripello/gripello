import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useCoarsePointer } from '~/composables/useCoarsePointer'

describe('useCoarsePointer', () => {
    it('follows the pointer media query until unmount', async () => {
        const query = Object.assign(new EventTarget(), { matches: true })
        vi.stubGlobal('matchMedia', () => query)
        onTestFinished(() => vi.unstubAllGlobals())
        let coarse!: ReturnType<typeof useCoarsePointer>
        const wrapper = mount(
            defineComponent({
                setup() {
                    coarse = useCoarsePointer()
                    return () => h('div')
                },
            }),
        )
        expect(coarse.value).toBe(true)
        await nextTick()

        query.matches = false
        query.dispatchEvent(new Event('change'))
        expect(coarse.value).toBe(false)

        wrapper.unmount()
        query.matches = true
        query.dispatchEvent(new Event('change'))
        expect(coarse.value).toBe(false)
    })
})
