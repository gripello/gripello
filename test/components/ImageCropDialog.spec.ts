import { useTemplateRef } from 'vue'
import { mount } from '@vue/test-utils'
import ImageCropDialog from '~/components/ImageCropDialog.vue'

vi.stubGlobal('useTemplateRef', useTemplateRef)

const shellStub = {
    props: ['modelValue'],
    template: '<div v-if="modelValue"><slot /><slot name="actions" /></div>',
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
})
