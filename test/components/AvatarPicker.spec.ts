import { defineComponent, h, useTemplateRef } from 'vue'
import { mount } from '@vue/test-utils'
import AvatarPicker from '~/components/user/AvatarPicker.vue'

const ButtonStub = defineComponent({
    inheritAttrs: false,
    setup(_, { attrs }) {
        return () =>
            h('button', {
                'data-testid': attrs['data-testid'],
                onClick: attrs.onClick,
            })
    },
})

function mountPicker(props: { preview: string | null; removable?: boolean }) {
    return mount(AvatarPicker, {
        props: { testIdPrefix: 'p', ...props },
        global: {
            stubs: {
                UTooltip: { template: '<div><slot /></div>' },
                UAvatar: true,
                UIcon: true,
                UButton: ButtonStub,
            },
            mocks: { $t: (key: string) => key },
        },
    })
}

vi.stubGlobal('useTemplateRef', useTemplateRef)

describe('AvatarPicker', () => {
    it('emits the chosen file', async () => {
        const wrapper = mountPicker({ preview: null })
        const input = wrapper.get('[data-testid="p-avatar-input"]')
        const file = new File(['x'], 'a.png', { type: 'image/png' })
        Object.defineProperty(input.element, 'files', { value: [file] })
        await input.trigger('change')
        expect(wrapper.emitted('select')).toEqual([[file]])
    })

    it('offers removal only for an existing removable avatar', async () => {
        expect(
            mountPicker({ preview: '/a.png' })
                .find('[data-testid="p-avatar-remove"]')
                .exists(),
        ).toBe(false)
        expect(
            mountPicker({ preview: null, removable: true })
                .find('[data-testid="p-avatar-remove"]')
                .exists(),
        ).toBe(false)
        const wrapper = mountPicker({ preview: '/a.png', removable: true })
        await wrapper.get('[data-testid="p-avatar-remove"]').trigger('click')
        expect(wrapper.emitted('remove')).toHaveLength(1)
    })
})
