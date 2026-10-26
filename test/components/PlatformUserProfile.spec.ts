import { mount } from '@vue/test-utils'
import { computed, nextTick, reactive, ref } from 'vue'
import UserProfile from '~/components/platform/UserProfile.vue'
import { useDraft } from '~/composables/useDraft'
import { useReauth } from '~/composables/useReauth'

const updatePlatformUser = vi.hoisted(() => vi.fn())
vi.mock('~/api/platform', () => ({ updatePlatformUser }))

const inputStub = {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template: `<input :value="modelValue" :disabled="disabled"
    @input="$emit('update:modelValue', $event.target.value)" />`,
}
const formStub = {
    props: ['disabled'],
    emits: ['submit'],
    template:
        '<form :data-disabled="disabled" @submit.prevent="$emit(\'submit\')"><slot /></form>',
}
const slotStub = { template: '<div><slot /></div>' }
const buttonStub = {
    inheritAttrs: false,
    props: ['disabled', 'type'],
    template:
        '<button :type="type ?? \'button\'" :disabled="disabled" :data-testid="$attrs[\'data-testid\']" @click="$attrs.onClick?.()"><slot /></button>',
}

const user = {
    id: 'u1',
    username: 'paula',
    firstname: 'Paula',
    name: 'User',
    email: 'paula@gripello.test',
    verified: false,
    email_visibility: false,
    language: '',
    platform_admin: false,
    memberships: [],
}

function mountProfile(props: Record<string, unknown> = {}) {
    return mount(UserProfile, {
        props: { user, ...props },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UForm: formStub,
                UFormField: slotStub,
                UInput: inputStub,
                USelect: true,
                USwitch: true,
                UButton: buttonStub,
                UserProfileImages: true,
                UserReauthField: true,
            },
        },
    })
}

describe('PlatformUserProfile', () => {
    beforeEach(() => {
        updatePlatformUser.mockReset()
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('useDraft', useDraft)
        vi.stubGlobal('useReauth', useReauth)
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: (fn: () => unknown) => fn(),
        }))
        globalThis.__AUTH_STORE__ = { record: { id: 'admin' } }
    })

    it('saves only the changed fields inline and hides the save bar again', async () => {
        updatePlatformUser.mockResolvedValue({ ...user, username: 'renamed' })
        const wrapper = mountProfile()
        const save = () => wrapper.find('[data-testid="platform-user-save"]')
        expect(save().exists()).toBe(false)

        await wrapper
            .get('[data-testid="platform-user-username"]')
            .setValue(' renamed ')
        expect(save().exists()).toBe(true)
        await wrapper.get('form').trigger('submit')
        await nextTick()

        expect(updatePlatformUser).toHaveBeenCalledWith(
            'u1',
            { username: 'renamed' },
            {},
        )
        expect(wrapper.emitted('changed')).toHaveLength(1)
    })

    it('discards typed changes', async () => {
        const wrapper = mountProfile()
        const username = wrapper.get('[data-testid="platform-user-username"]')
        await username.setValue('renamed')
        await wrapper
            .get('[data-testid="platform-user-discard"]')
            .trigger('click')

        expect((username.element as HTMLInputElement).value).toBe('paula')
        expect(
            wrapper.find('[data-testid="platform-user-save"]').exists(),
        ).toBe(false)
    })

    it('keeps typed changes when the list reloads the same user', async () => {
        const wrapper = mountProfile()
        const username = wrapper.get('[data-testid="platform-user-username"]')
        await username.setValue('renamed')

        await wrapper.setProps({ user: { ...user } })
        await nextTick()

        expect((username.element as HTMLInputElement).value).toBe('renamed')
    })

    it('is read-only for another platform admin', () => {
        const wrapper = mountProfile({
            user: { ...user, platform_admin: true },
        })

        expect(wrapper.get('form').attributes('data-disabled')).toBe('true')
        expect(
            wrapper.findComponent({ name: 'UserProfileImages' }).exists(),
        ).toBe(false)
    })

    it('stays editable on the own admin account, except the e-mail', () => {
        globalThis.__AUTH_STORE__ = { record: { id: 'u1' } }
        const wrapper = mountProfile({
            user: { ...user, platform_admin: true },
        })
        const email = wrapper.get('[data-testid="platform-user-email"]')
            .element as HTMLInputElement

        expect(wrapper.get('form').attributes('data-disabled')).toBe('false')
        expect(email.disabled).toBe(true)
    })
})
