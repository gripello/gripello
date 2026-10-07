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
})
