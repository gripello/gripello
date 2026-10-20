import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import VirtualWindow from '~/components/virtual/Window.vue'

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void

class MockIntersectionObserver {
    static instances: MockIntersectionObserver[] = []
    callback: IOCallback
    options: IntersectionObserverInit | undefined
    elements = new Set<Element>()

    constructor(callback: IOCallback, options?: IntersectionObserverInit) {
        this.callback = callback
        this.options = options
        MockIntersectionObserver.instances.push(this)
    }

    observe(el: Element) {
        this.elements.add(el)
    }

    unobserve(el: Element) {
        this.elements.delete(el)
    }

    disconnect() {
        this.elements.clear()
    }

    trigger(isIntersecting: boolean) {
        this.callback([{ isIntersecting }])
    }
}

function observers() {
    const [near, far] = MockIntersectionObserver.instances
    return { near, far }
}

function createWrapper(props: Record<string, unknown> = {}) {
    return mount(VirtualWindow, {
        props,
        slots: {
            default: '<div class="content">card content</div>',
        },
    })
}

describe('VirtualWindow', () => {
    beforeEach(() => {
        MockIntersectionObserver.instances = []
        vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    })

    it('renders a fixed-height placeholder instead of the slot initially', () => {
        const wrapper = createWrapper({ estimatedHeight: 300 })

        expect(wrapper.find('.content').exists()).toBe(false)
        expect(wrapper.attributes('style')).toContain('height: 300px')
    })

    it('mounts the slot when it enters the mount band', async () => {
        const wrapper = createWrapper()

        observers().near.trigger(true)
        await nextTick()

        expect(wrapper.find('.content').exists()).toBe(true)
        expect(wrapper.attributes('style')).toBeFalsy()
    })

    it('stays mounted between the bands (hysteresis)', async () => {
        const wrapper = createWrapper()
        const { near } = observers()

        near.trigger(true)
        await nextTick()
        near.trigger(false)
        await nextTick()

        expect(wrapper.find('.content').exists()).toBe(true)
    })

    it('unmounts the slot when it leaves the unmount band', async () => {
        const wrapper = createWrapper()
        const { near, far } = observers()

        near.trigger(true)
        await nextTick()
        far.trigger(false)
        await nextTick()

        expect(wrapper.find('.content').exists()).toBe(false)
        expect(wrapper.attributes('style')).toContain('height')
    })

    it('observes with the configured margins', () => {
        createWrapper({
            mountMargin: '100px 0px',
            unmountMargin: '900px 0px',
        })
        const { near, far } = observers()

        expect(near.options?.rootMargin).toBe('100px 0px')
        expect(far.options?.rootMargin).toBe('900px 0px')
    })

    it('disconnects both observers on unmount', () => {
        const wrapper = createWrapper()
        const { near, far } = observers()
        const nearSpy = vi.spyOn(near, 'disconnect')
        const farSpy = vi.spyOn(far, 'disconnect')

        wrapper.unmount()

        expect(nearSpy).toHaveBeenCalled()
        expect(farSpy).toHaveBeenCalled()
    })

    it('always renders the slot when IntersectionObserver is unavailable', async () => {
        vi.stubGlobal('IntersectionObserver', undefined)

        const wrapper = createWrapper()
        await nextTick()

        expect(wrapper.find('.content').exists()).toBe(true)
    })
})
