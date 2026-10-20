import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useMountedNow } from '~/composables/useMountedNow'

afterEach(() => vi.useRealTimers())

describe('useMountedNow', () => {
    it('starts without a clock, ticks after mount and stops on unmount', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-20T10:00:00Z'))
        let now!: ReturnType<typeof useMountedNow>
        let beforeMount: Date | null | undefined
        const wrapper = mount(
            defineComponent({
                setup() {
                    now = useMountedNow(1000)
                    beforeMount = now.value
                    return () => h('div')
                },
            }),
        )
        expect(beforeMount).toBeNull()
        expect(now.value?.toISOString()).toBe('2026-10-20T10:00:00.000Z')

        vi.advanceTimersByTime(1000)
        expect(now.value?.toISOString()).toBe('2026-10-20T10:00:01.000Z')

        wrapper.unmount()
        vi.advanceTimersByTime(5000)
        expect(now.value?.toISOString()).toBe('2026-10-20T10:00:01.000Z')
    })
})
