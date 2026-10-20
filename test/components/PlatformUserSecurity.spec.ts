import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import UserSecurity from '~/components/platform/UserSecurity.vue'
import en from '../../i18n/locales/en.json'
import { useReauth } from '~/composables/useReauth'

vi.mock('~/api/platform', async (importActual) => ({
    ...(await importActual<typeof import('~/api/platform')>()),
    clearUserLockout: () => new Promise(() => undefined),
}))

describe('PlatformUserSecurity', () => {
    it('renders no confirmation text while unlocking', async () => {
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('useReauth', useReauth)
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(true),
            run: (action: () => Promise<unknown>) => action(),
        }))
        const wrapper = mount(UserSecurity, {
            props: {
                user: {
                    id: 'u1',
                    locked_until: '2099-01-01T00:00:00.000Z',
                } as never,
            },
            global: {
                stubs: {
                    LayoutDialogShell: { template: '<div><slot /></div>' },
                    UserPasswordChangeFields: true,
                    UserPasswordField: true,
                    UBadge: true,
                    USwitch: true,
                    UButton: {
                        template:
                            '<button @click="$emit(\'click\')"><slot /></button>',
                    },
                },
            },
        })
        await wrapper
            .get('[data-testid="platform-user-unlock"]')
            .trigger('click')
        expect(wrapper.find('p').exists()).toBe(false)
        expect(en.platform.users.actions.unlock).not.toHaveProperty('message')
    })
})
