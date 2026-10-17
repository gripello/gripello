import { mount } from '@vue/test-utils'
import { useTemplateRef } from 'vue'
import BetaPlayer from '~/components/route/BetaPlayer.vue'

vi.stubGlobal('useTemplateRef', useTemplateRef)

const mountPlayer = () =>
    mount(BetaPlayer, {
        props: { src: 'https://example.com/beta.mp4' },
        global: { stubs: { UIcon: true } },
    })

describe('RouteBetaPlayer', () => {
    it('requests element fullscreen and swallows a rejection', async () => {
        const wrapper = mountPlayer()
        const request = vi.fn().mockRejectedValue(new Error('denied'))
        Object.assign(wrapper.element, { requestFullscreen: request })

        await wrapper.get('[data-testid="beta-fullscreen"]').trigger('click')

        expect(request).toHaveBeenCalled()
    })

    it('falls back to native video fullscreen without element fullscreen', async () => {
        const wrapper = mountPlayer()
        Object.assign(wrapper.element, { requestFullscreen: undefined })
        const enter = vi.fn()
        Object.assign(wrapper.get('video').element, {
            webkitEnterFullscreen: enter,
        })

        await wrapper.get('[data-testid="beta-fullscreen"]').trigger('click')

        expect(enter).toHaveBeenCalled()
    })

    it('keeps controls visible on touch screens while playing', async () => {
        const wrapper = mountPlayer()
        await wrapper.get('video').trigger('play')

        expect(
            wrapper.get('[data-testid="beta-fullscreen"]').element.parentElement
                ?.parentElement?.className,
        ).toContain('pointer-coarse:opacity-100')
    })

    it('turns the fullscreen button into an exit button while fullscreen', async () => {
        const wrapper = mountPlayer()
        const button = () => wrapper.get('[data-testid="beta-fullscreen"]')
        const exit = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: exit,
        })
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => wrapper.element,
        })
        document.dispatchEvent(new Event('fullscreenchange'))
        await wrapper.vm.$nextTick()

        expect(button().attributes('aria-label')).toBe('beta.exitFullscreen')
        await button().trigger('click')
        expect(exit).toHaveBeenCalled()

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => null,
        })
        document.dispatchEvent(new Event('fullscreenchange'))
        await wrapper.vm.$nextTick()
        expect(button().attributes('aria-label')).toBe('beta.fullscreen')
        wrapper.unmount()
    })

    it('gives every control a full touch target', () => {
        const wrapper = mountPlayer()
        for (const button of wrapper.findAll('.beta-player__button'))
            expect(button.classes()).toContain('icon-btn')
    })
})
