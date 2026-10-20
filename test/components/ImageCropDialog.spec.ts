import { useTemplateRef } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ImageCropDialog from '~/components/image/CropDialog.vue'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.stubGlobal('useTemplateRef', useTemplateRef)

const shellStub = {
    ...dialogShellStub,
    template: `<div v-if="modelValue">${dialogShellStub.template}</div>`,
}

function mountDialog(props: Record<string, unknown>) {
    return mount(ImageCropDialog, {
        props: {
            file: new File(['x'], 'a.png', { type: 'image/png' }),
            title: 'Crop',
            aspect: 1,
            outputWidth: 640,
            ...props,
        },
        global: {
            stubs: {
                LayoutDialogShell: shellStub,
                UButton: {
                    inheritAttrs: false,
                    template:
                        '<button :data-testid="$attrs[\'data-testid\']" @click="$attrs.onClick"><slot /></button>',
                },
                USlider: true,
            },
            mocks: { $t: (key: string) => key },
        },
    })
}

async function loadImage(wrapper: ReturnType<typeof mountDialog>) {
    const image = wrapper.get('img').element as HTMLImageElement
    Object.defineProperty(image, 'naturalWidth', { value: 800 })
    Object.defineProperty(image, 'naturalHeight', { value: 400 })
    await wrapper.get('img').trigger('load')
}

describe('ImageCropDialog', () => {
    beforeEach(() => {
        vi.stubGlobal('URL', {
            ...URL,
            createObjectURL: () => 'blob:x',
            revokeObjectURL: () => {},
        })
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        )
    })

    it('shows round previews for avatars once the image loads', async () => {
        const wrapper = mountDialog({ round: true })
        expect(
            wrapper.find('[data-testid="image-crop-previews"]').exists(),
        ).toBe(false)

        await loadImage(wrapper)

        expect(
            wrapper.findAll('[data-testid="image-crop-previews"] img'),
        ).toHaveLength(3)
    })

    it('marks where the avatar overlaps a banner', async () => {
        const wrapper = mountDialog({ aspect: 4, avatarMarker: true })
        await loadImage(wrapper)

        expect(
            wrapper.find('[data-testid="image-crop-avatar-marker"]').exists(),
        ).toBe(true)
        expect(
            wrapper.find('[data-testid="image-crop-previews"]').exists(),
        ).toBe(false)
        expect(
            wrapper.get('[data-testid="image-crop-stage"]').attributes(),
        ).toHaveProperty('data-vaul-no-drag')
    })

    it('cancels when closed', async () => {
        const wrapper = mountDialog({})
        await wrapper
            .findAll('button')
            .find((button) => button.text() === 'actions.cancel')!
            .trigger('click')

        expect(wrapper.emitted('cancel')).toHaveLength(1)
    })
    it('exports a wide banner as a smooth, opaque jpeg', async () => {
        const context = {
            imageSmoothingQuality: 'low',
            fillRect: vi.fn(),
            drawImage: vi.fn(),
        }
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
            context as unknown as CanvasRenderingContext2D,
        )
        const toBlob = vi
            .spyOn(HTMLCanvasElement.prototype, 'toBlob')
            .mockImplementation(function (this: HTMLCanvasElement, done) {
                done(new Blob(['x']))
            })
        const wrapper = mountDialog({ aspect: 4, outputWidth: 2400 })
        const image = wrapper.get('img').element as HTMLImageElement
        Object.defineProperty(image, 'naturalWidth', { value: 4000 })
        Object.defineProperty(image, 'naturalHeight', { value: 1000 })
        await wrapper.get('img').trigger('load')

        await wrapper.get('[data-testid="image-crop-save"]').trigger('click')
        await flushPromises()

        const canvas = toBlob.mock.contexts[0] as HTMLCanvasElement
        expect([canvas.width, canvas.height]).toEqual([2400, 600])
        expect(context.imageSmoothingQuality).toBe('high')
        expect(context.fillRect).toHaveBeenCalled()
        expect(toBlob.mock.calls[0]?.[1]).toBe('image/jpeg')
        const [file] = wrapper.emitted('cropped')![0] as [File]
        expect(file.name).toBe('a.jpg')
        vi.restoreAllMocks()
    })
})
