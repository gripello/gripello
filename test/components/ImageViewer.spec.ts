import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, useTemplateRef } from 'vue'
import ImageViewer from '~/components/layout/ImageViewer.vue'
import ZoomableImage from '~/components/layout/ZoomableImage.vue'

vi.stubGlobal('useTemplateRef', useTemplateRef)

const DialogShell = defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup(props, { slots, emit }) {
        return () =>
            props.modelValue
                ? h('div', { 'data-dialog': '' }, [
                      slots.default?.(),
                      h('button', {
                          'data-close': '',
                          onClick: () => emit('update:modelValue', false),
                      }),
                  ])
                : null
    },
})

function mountViewer() {
    return mount(ImageViewer, {
        props: { src: '/photo.jpg', alt: 'Photo' },
        slots: { default: '<img src="/thumb.jpg" data-thumb />' },
        global: {
            stubs: { LayoutDialogShell: DialogShell },
            components: { LayoutZoomableImage: ZoomableImage },
        },
    })
}

describe('ImageViewer', () => {
    it('opens the full image in an in-app dialog instead of a new page', async () => {
        const wrapper = mountViewer()
        expect(wrapper.find('a[target="_blank"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="image-viewer-full"]').exists()).toBe(
            false,
        )

        await wrapper.find('button').trigger('click')

        expect(
            wrapper.find('[data-testid="image-viewer-full"]').attributes('src'),
        ).toBe('/photo.jpg')
    })

    it('closes again', async () => {
        const wrapper = mountViewer()
        await wrapper.find('button').trigger('click')
        await wrapper.find('[data-close]').trigger('click')

        expect(wrapper.find('[data-dialog]').exists()).toBe(false)
    })
})

describe('ZoomableImage', () => {
    it('zooms in on a double tap and out on the next one', async () => {
        vi.useFakeTimers()
        const wrapper = mount(ZoomableImage, {
            props: { src: '/photo.jpg', alt: 'Photo' },
        })
        const frame = wrapper.find('[data-testid="zoomable-image"]')
        const tap = async (time: number) => {
            vi.setSystemTime(time)
            const init = { pointerId: 1, clientX: 10, clientY: 10 }
            frame.element.dispatchEvent(new PointerEvent('pointerdown', init))
            frame.element.dispatchEvent(new PointerEvent('pointerup', init))
            await nextTick()
        }

        await tap(0)
        await tap(100)
        expect(frame.attributes('data-zoom')).toBe('3')

        await tap(1000)
        await tap(1100)
        expect(frame.attributes('data-zoom')).toBe('1')
        vi.useRealTimers()
    })

    it('does not count swipes as taps', async () => {
        vi.useFakeTimers()
        const wrapper = mount(ZoomableImage, {
            props: { src: '/photo.jpg', alt: 'Photo' },
        })
        const frame = wrapper.find('[data-testid="zoomable-image"]')
        const swipe = async (time: number) => {
            vi.setSystemTime(time)
            const at = (clientX: number) => ({
                pointerId: 1,
                clientX,
                clientY: 10,
            })
            frame.element.dispatchEvent(new PointerEvent('pointerdown', at(10)))
            frame.element.dispatchEvent(new PointerEvent('pointermove', at(60)))
            frame.element.dispatchEvent(new PointerEvent('pointerup', at(60)))
            await nextTick()
        }

        await swipe(0)
        await swipe(100)
        expect(frame.attributes('data-zoom')).toBe('1')
        vi.useRealTimers()
    })
})
