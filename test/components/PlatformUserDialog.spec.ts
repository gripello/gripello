import { mount } from '@vue/test-utils'
import { nextTick, reactive, ref } from 'vue'
import UserDialog from '~/components/platform/UserDialog.vue'

const inputStub = {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<input :value="modelValue"
    @input="$emit('update:modelValue', $event.target.value)" />`,
}
const slotStub = { template: '<div><slot /></div>' }

const user = {
    id: 'u1',
    username: 'paula',
    firstname: 'Paula',
    name: 'User',
    email: 'paula@gripello.test',
    verified: false,
    expand: {},
}

describe('PlatformUserDialog', () => {
    beforeEach(() => {
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: vi.fn(),
        }))
        vi.stubGlobal('usePbFileUrl', () => null)
        globalThis.__POCKETBASE_CLIENT__ = { authStore: { record: null } }
    })

    it('keeps typed changes when the list reloads the same user', async () => {
        const wrapper = mount(UserDialog, {
            props: { modelValue: true, user, gyms: [], roles: [] },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    LayoutDialogShell: slotStub,
                    UForm: slotStub,
                    UFormField: slotStub,
                    UInput: inputStub,
                },
                renderStubDefaultSlot: true,
            },
            shallow: true,
        })
        const username = wrapper.find('[data-testid="platform-user-username"]')
        await username.setValue('renamed')

        await wrapper.setProps({ user: { ...user } })
        await nextTick()

        expect((username.element as HTMLInputElement).value).toBe('renamed')
    })
})
