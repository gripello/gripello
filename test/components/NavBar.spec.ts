import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref, useTemplateRef } from 'vue'
import NavBar from '~/components/layout/NavBar.vue'

vi.stubGlobal('useTemplateRef', useTemplateRef)
vi.stubGlobal('useThemeMode', () => ({ mode: ref('system'), setMode: vi.fn() }))
vi.stubGlobal('usePermissions', () => ({ can: () => false }))
vi.stubGlobal('useStaffExit', () => computed(() => '/e2e/routes'))
vi.stubGlobal('useGym', () => ({
    slug: computed(() => 'e2e'),
    gym: computed(() => ({ name: 'E2E Gym' })),
}))
vi.stubGlobal('useSidebar', () => ({ open: ref(false), toggle: vi.fn() }))
const route = { path: '/e2e/routes', params: { gym: 'e2e' } }
vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('routeGymSlug', (params: { gym?: string }) => params.gym ?? '')
vi.stubGlobal('useFollows', () => ({ requests: ref([]) }))
const parent = ref<string | null>(null)
vi.stubGlobal('useGoBack', () => ({ parent, goBack: vi.fn() }))

const UHeader = defineComponent({
    props: { ui: { type: Object, default: () => ({}) } },
    setup(props, { slots }) {
        return () =>
            h('header', { class: props.ui.root }, [
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
    it('pads its content below the standalone status bar', () => {
        expect(mountNavBar(true).find('header').classes()).toContain(
            'pt-[var(--app-top-inset,0px)]',
        )
    })

    it('keeps the header opaque on touch devices, translucent only with a mouse', () => {
        const classes = mountNavBar(true).find('header').classes()

        expect(classes).toEqual(
            expect.arrayContaining(['bg-default', 'backdrop-blur-none']),
        )
        expect(classes).toContain('lg:pointer-fine:backdrop-blur-md')
        expect(classes).not.toContain('lg:backdrop-blur-md')
    })

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
            expect.arrayContaining([
                'icon-btn',
                'whitespace-nowrap',
                'lg:hidden',
            ]),
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
        ).toEqual([
            'section-tab-routes',
            'section-tab-map',
            'section-tab-info',
            'section-tab-home',
        ])
    })

    it('divides the section tabs from the top bar', () => {
        const tabs = mountNavBar(true).get('[data-section-tabs]')
        expect(tabs.classes()).toEqual(
            expect.arrayContaining(['border-t', 'border-default']),
        )
    })

    it('shows a back arrow instead of the gym switcher on nested pages', () => {
        expect(
            mountNavBar(true).find('[data-testid="nav-back"]').exists(),
        ).toBe(false)
        parent.value = '/e2e/routes'
        const nested = mountNavBar(true)
        expect(nested.find('[data-testid="nav-back"]').exists()).toBe(true)
        expect(
            nested.findComponent({ name: 'LayoutGymSwitcher' }).classes(),
        ).toContain('max-lg:hidden')
        parent.value = null
    })

    it('labels nested staff pages instead of offering a second way out', () => {
        route.path = '/e2e/manage/analytics'
        parent.value = '/e2e/manage'
        const nested = mountNavBar(true)
        expect(nested.find('[data-testid="nav-staff-context"]').exists()).toBe(
            true,
        )
        expect(
            nested.find('[data-testid="nav-back-to-climbing-mobile"]').exists(),
        ).toBe(false)
        route.path = '/e2e/routes'
        parent.value = null
    })
})
