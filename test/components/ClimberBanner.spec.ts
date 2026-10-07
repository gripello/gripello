import { flushPromises, mount } from '@vue/test-utils'
import ClimberBanner from '~/components/climber/Banner.vue'

const testId = (wrapper: ReturnType<typeof mount>) =>
    wrapper.find('[data-testid^="climber-banner-"]').attributes('data-testid')

describe('ClimberBanner', () => {
    it('prefers the uploaded banner', () => {
        const wrapper = mount(ClimberBanner, {
            props: { banner: 'b.jpg', avatar: 'a.jpg', name: 'Anna' },
        })
        expect(testId(wrapper)).toBe('climber-banner-image')
        expect(wrapper.get('img').attributes('src')).toBe('b.jpg')
    })

    it('paints the avatar colours as a gradient', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ blob: async () => new Blob() })),
        )
        const close = vi.fn()
        vi.stubGlobal(
            'createImageBitmap',
            vi.fn(async () => ({ close })),
        )
        const blue = Array.from({ length: 1024 }, () => [30, 90, 200, 255])
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            drawImage: () => undefined,
            getImageData: () => ({ data: blue.flat() }),
        } as unknown as CanvasRenderingContext2D)

        const wrapper = mount(ClimberBanner, {
            props: { avatar: 'a.jpg', name: 'Anna' },
        })
        expect(testId(wrapper)).toBe('climber-banner-color')
        await flushPromises()
        expect(testId(wrapper)).toBe('climber-banner-avatar')
        expect(close).toHaveBeenCalled()
        vi.restoreAllMocks()
    })

    it('ignores a palette that arrives after the avatar changed', async () => {
        let finishFirst: (blob: Blob) => void = () => undefined
        vi.stubGlobal(
            'fetch',
            vi.fn((src: string) =>
                src === 'old.jpg'
                    ? Promise.resolve({
                          blob: () =>
                              new Promise<Blob>((done) => (finishFirst = done)),
                      })
                    : Promise.reject(new Error('gone')),
            ),
        )
        vi.stubGlobal(
            'createImageBitmap',
            vi.fn(async () => ({ close: vi.fn() })),
        )
        const blue = Array.from({ length: 1024 }, () => [30, 90, 200, 255])
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            drawImage: () => undefined,
            getImageData: () => ({ data: blue.flat() }),
        } as unknown as CanvasRenderingContext2D)

        const wrapper = mount(ClimberBanner, {
            props: { avatar: 'old.jpg', name: 'Anna' },
        })
        await flushPromises()
        await wrapper.setProps({ avatar: 'new.jpg' })
        await flushPromises()
        finishFirst(new Blob())
        await flushPromises()
        expect(testId(wrapper)).toBe('climber-banner-color')
        vi.restoreAllMocks()
    })

    it('falls back to the initials colour', () => {
        const wrapper = mount(ClimberBanner, { props: { name: 'Anna' } })
        expect(testId(wrapper)).toBe('climber-banner-color')
    })
})
