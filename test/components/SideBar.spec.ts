import { mount } from '@vue/test-utils'
import { onTestFinished } from 'vitest'
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
const viewport = ref(1440)
const mounted = ref(true)
vi.mock('@vueuse/core', async (original) => ({
    ...(await original<typeof import('@vueuse/core')>()),
    useMediaQuery: () => computed(() => viewport.value >= 1024),
    useMounted: () => mounted,
}))
vi.stubGlobal('useCoarsePointer', () => ref(false))
vi.stubGlobal('useHydrated', () => ref(true))
vi.stubGlobal('useStaffExit', () => computed(() => '/e2e/routes'))
vi.stubGlobal('useGym', () => ({
    gym: computed(() => ({ name: 'E2E Gym' })),
    slug: computed(() => 'e2e'),
}))
vi.stubGlobal('useAuthStore', () => ({ record: null }))
vi.stubGlobal('useTemplateRef', () => ref(null))
vi.stubGlobal('useScrollShadow', () => ({ style: ref({}) }))
vi.stubGlobal('useModerationSummary', () => ({ badges: ref({}) }))

const USidebar = defineComponent({
    props: { open: { type: Boolean, default: false } },
    setup(props, { slots }) {
        return () =>
            h('aside', { 'data-open': String(props.open) }, [
                slots.header?.(),
                slots.default?.(),
                slots.footer?.(),
            ])
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

describe('SideBar at phone width', () => {
    afterEach(() => {
        viewport.value = 1440
    })

    it('drops the sidebar on phones, so its slide-over menu can never open, and restores the rail on desktop', async () => {
        const wrapper = mountSideBar(true)
        expect(wrapper.find('aside').attributes('data-open')).toBe('true')
        viewport.value = 393
        await wrapper.vm.$nextTick()
        expect(wrapper.find('aside').exists()).toBe(false)
        viewport.value = 1440
        await wrapper.vm.$nextTick()
        expect(wrapper.find('aside').attributes('data-open')).toBe('true')
    })

    it('keeps the server-rendered state until it is mounted', () => {
        viewport.value = 393
        mounted.value = false
        onTestFinished(() => {
            mounted.value = true
        })
        expect(mountSideBar(true).find('aside').attributes('data-open')).toBe(
            'true',
        )
    })
})
