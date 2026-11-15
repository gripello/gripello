import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const platform = vi.hoisted(() => ({ ios: false }))
vi.mock('~/utils/native', () => ({
    isInstalledApp: () => true,
    isIos: () => platform.ios,
}))

const { default: PullToRefresh } =
    await import('~/components/layout/PullToRefresh.vue')

function touch(type: string, y: number, prevent = false, x = 0) {
    const event = new Event(type, {
        bubbles: true,
        cancelable: true,
    }) as TouchEvent
    const point = { clientX: x, clientY: y }
    Object.defineProperty(event, 'touches', {
        value: type === 'touchend' ? [] : [point],
    })
    if (prevent) event.preventDefault()
    document.body.dispatchEvent(event)
    return event
}

describe('LayoutPullToRefresh', () => {
    it('pulls from the page top', async () => {
        const wrapper = mount(PullToRefresh)
        touch('touchstart', 0)
        touch('touchmove', 40)
        await nextTick()
        expect(wrapper.find('[data-testid="pull-indicator"]').exists()).toBe(
            true,
        )
        wrapper.unmount()
    })

    it('lets a gesture another handler claimed go', async () => {
        const wrapper = mount(PullToRefresh)
        touch('touchstart', 0)
        touch('touchmove', 40, true)
        touch('touchmove', 80)
        await nextTick()
        expect(wrapper.find('[data-testid="pull-indicator"]').exists()).toBe(
            false,
        )
        wrapper.unmount()
    })

    it('keeps the native overscroll off while pulling, not while swiping sideways', () => {
        const wrapper = mount(PullToRefresh)
        touch('touchstart', 0)
        expect(touch('touchmove', 5).defaultPrevented).toBe(true)
        touch('touchend', 5)
        touch('touchstart', 0)
        expect(touch('touchmove', 5, false, 30).defaultPrevented).toBe(false)
        wrapper.unmount()
    })

    it('slides the page below the top bar and shows the spoke spinner on iOS', async () => {
        platform.ios = true
        document.body.innerHTML = '<main id="main-content"></main>'
        const wrapper = mount(PullToRefresh, { attachTo: document.body })
        touch('touchstart', 0)
        touch('touchmove', 200)
        await nextTick()
        const main = document.getElementById('main-content')!
        expect(main.style.top).toBe('100px')
        expect(main.style.position).toBe('relative')
        expect(main.style.translate).toBe('')
        expect(
            wrapper.findAll('[data-testid="pull-indicator"] line'),
        ).toHaveLength(8)
        wrapper.unmount()
        platform.ios = false
        document.body.innerHTML = ''
    })
})
