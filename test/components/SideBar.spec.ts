import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import SideBar from '~/components/layout/SideBar.vue'

vi.stubGlobal('usePermissions', () => ({ can: () => false }))
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
vi.stubGlobal('useRoute', () => ({
    path: '/e2e/routes',
    fullPath: '/e2e/routes?grade=6a',
    params: { gym: 'e2e' },
}))
vi.stubGlobal('routeGymSlug', (params: { gym?: string }) => params.gym ?? '')
vi.stubGlobal('useSidebar', () => ({ open: ref(true) }))
vi.stubGlobal('useCoarsePointer', () => ref(false))
vi.stubGlobal('useHydrated', () => ref(true))
vi.stubGlobal('useGym', () => ({
    gym: computed(() => ({ name: 'E2E Gym' })),
    slug: computed(() => 'e2e'),
}))
vi.stubGlobal('useAuthStore', () => ({ record: null }))
vi.stubGlobal('useTemplateRef', () => ref(null))
vi.stubGlobal('useScrollShadow', () => ({ style: ref({}) }))
vi.stubGlobal('useModerationSummary', () => ({ badges: ref({}) }))

const USidebar = defineComponent({
    setup(_, { slots }) {
        return () =>
            h('aside', [slots.header?.(), slots.default?.(), slots.footer?.()])
    },
})

function mountSideBar(loggedIn: boolean) {
    return mount(SideBar, {
        props: { loggedIn },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                USidebar,
                UNavigationMenu: true,
                LayoutGymSwitcher: true,
                LayoutFootBar: true,
                UserIcon: {
                    template: '<div data-testid="user-menu-activator" />',
                },
                UButton: defineComponent({
                    props: { to: { type: [String, Object], default: '' } },
                    setup(props, { slots }) {
                        return () =>
                            h(
                                'a',
                                { 'data-to': JSON.stringify(props.to) },
                                slots.default?.(),
                            )
                    },
                }),
            },
        },
    })
}

describe('SideBar', () => {
    it('offers sign-in in the footer for guests', () => {
        const wrapper = mountSideBar(false)

        const to = wrapper
            .get('[data-testid="sidebar-login"]')
            .attributes('data-to')!
        expect(JSON.parse(to)).toEqual({
            path: '/auth/login',
            query: { redirect: '/e2e/routes?grade=6a' },
        })
        expect(
            wrapper.find('[data-testid="user-menu-activator"]').exists(),
        ).toBe(false)
    })

    it('shows the account menu instead once signed in', () => {
        const wrapper = mountSideBar(true)

        expect(wrapper.find('[data-testid="sidebar-login"]').exists()).toBe(
            false,
        )
        expect(
            wrapper.find('[data-testid="user-menu-activator"]').exists(),
        ).toBe(true)
    })
})
