import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.mock('~/utils/native', () => ({ isNativeApp: () => true }))

const { default: PullToRefresh } =
    await import('~/components/layout/PullToRefresh.vue')

function touch(type: string, y: number, prevent = false) {
    const event = new Event(type, {
        bubbles: true,
        cancelable: true,
    }) as TouchEvent
    const point = { clientX: 0, clientY: y }
    Object.defineProperty(event, 'touches', {
        value: type === 'touchend' ? [] : [point],
    })
    if (prevent) event.preventDefault()
    document.body.dispatchEvent(event)
}

describe('LayoutPullToRefresh', () => {
    it('pulls from the page top', async () => {
        const wrapper = mount(PullToRefresh, {
            global: { stubs: { UIcon: true } },
        })
        touch('touchstart', 0)
        touch('touchmove', 40)
        await nextTick()
        expect(wrapper.html()).not.toBe('<!--v-if-->')
        wrapper.unmount()
    })

    it('lets a gesture another handler claimed go', async () => {
        const wrapper = mount(PullToRefresh, {
            global: { stubs: { UIcon: true } },
        })
        touch('touchstart', 0)
        touch('touchmove', 40, true)
        touch('touchmove', 80)
        await nextTick()
        expect(wrapper.html()).toBe('<!--v-if-->')
        wrapper.unmount()
    })
})
