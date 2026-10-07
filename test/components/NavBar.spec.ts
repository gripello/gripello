import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref, useTemplateRef } from 'vue'
import NavBar from '~/components/layout/NavBar.vue'

vi.stubGlobal('useTemplateRef', useTemplateRef)
vi.stubGlobal('useThemeMode', () => ({ mode: ref('system'), setMode: vi.fn() }))
vi.stubGlobal('usePermissions', () => ({ can: () => false }))
vi.stubGlobal('useGym', () => ({
    slug: computed(() => 'e2e'),
    gym: computed(() => ({ name: 'E2E Gym' })),
}))
vi.stubGlobal('useSidebar', () => ({ open: ref(false), toggle: vi.fn() }))
const route = { path: '/e2e/routes', params: { gym: 'e2e' } }
vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('routeGymSlug', (params: { gym?: string }) => params.gym ?? '')
vi.stubGlobal('useFollows', () => ({ requests: ref([]) }))

const UHeader = defineComponent({
    props: { ui: { type: Object, default: () => ({}) } },
    setup(props, { slots }) {
        return () =>
            h('header', [
                h('div', { class: props.ui.left }, slots.left?.()),
                h('div', { class: props.ui.right }, slots.right?.()),
                slots.bottom?.(),
            ])
    },
})
const UButton = defineComponent({
    setup(_, { slots }) {
        return () => h('a', slots.default?.())
    },
})

function mountNavBar(loggedIn: boolean) {
    return mount(NavBar, {
        props: { loggedIn },
        global: {
            mocks: { $route: { meta: {} }, $t: (key: string) => key },
            stubs: {
                UHeader,
                UButton,
                UDropdownMenu: { template: '<div><slot /></div>' },
                LayoutGymSwitcher: true,
                LayoutCommandPalette: true,
                NotificationsBell: true,
                UChip: { template: '<span><slot /></span>' },
            },
        },
    })
}

describe('NavBar', () => {
    it('lets the gym switcher shrink while the actions keep their width', () => {
        const wrapper = mountNavBar(false)
        const [left, right] = wrapper.findAll('header > div')

        expect(left!.classes()).toEqual(
            expect.arrayContaining(['min-w-0', 'flex-1']),
        )
        expect(right!.classes()).toContain('shrink-0')
        expect(wrapper.get('layout-gym-switcher-stub').classes()).not.toContain(
            'max-w-[55vw]',
        )
    })

    it('shows the sign-in button icon-only below sm with an accessible name', () => {
        const login = mountNavBar(false).get('[data-testid="nav-login"]')

        expect(login.attributes('aria-label')).toBe('routes.login')
        expect(login.classes()).toEqual(
            expect.arrayContaining(['icon-btn', 'whitespace-nowrap']),
        )
        expect(login.get('span').classes()).toContain('max-sm:hidden')
    })

    it('shows the bell instead of sign-in when logged in', () => {
        const wrapper = mountNavBar(true)

        expect(wrapper.find('[data-testid="nav-login"]').exists()).toBe(false)
        expect(wrapper.find('notifications-bell-stub').exists()).toBe(true)
    })

    it('keeps the theme toggle on phones for guests only', () => {
        const toggle = (loggedIn: boolean) =>
            mountNavBar(loggedIn)
                .get('[data-testid="nav-theme-toggle"]')
                .classes()

        expect(toggle(false)).not.toContain('max-lg:hidden')
        expect(toggle(true)).toContain('max-lg:hidden')
    })

    it('shows the sibling sections of the current zone', () => {
        const wrapper = mountNavBar(true)
        expect(
            wrapper
                .findAll('[data-testid^="section-tab-"]')
                .map((tab) => tab.attributes('data-testid')),
        ).toEqual(['section-tab-routes', 'section-tab-map', 'section-tab-home'])
    })

    it('divides the section tabs from the top bar', () => {
        const tabs = mountNavBar(true).get('[data-section-tabs]')
        expect(tabs.classes()).toEqual(
            expect.arrayContaining(['border-t', 'border-default']),
        )
    })
})
