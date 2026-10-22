import { defineComponent, h, onUnmounted, reactive, ref } from 'vue'
import { mount } from '@vue/test-utils'
import SettingsLayout from '~/components/settings/Layout.vue'
import { useDiscardConfirm } from '~/composables/useDiscardConfirm'
import { useSectionQuery } from '~/composables/useSectionQuery'

const route = reactive({
    path: '/platform/settings',
    query: {} as Record<string, string>,
})
const pageBackTo = ref<{ owner: number; to: string } | null>(null)
const leaveGuards: (() => Promise<boolean>)[] = []

const NavStub = defineComponent({
    props: { items: { type: Array, default: () => [] } },
    setup(props) {
        return () =>
            h(
                'ul',
                (props.items as { label: string; active: boolean }[]).map(
                    (item) =>
                        h('li', { 'data-active': item.active }, item.label),
                ),
            )
    },
})

const TabsStub = defineComponent({
    props: {
        modelValue: { type: String, default: '' },
        items: { type: Array, default: () => [] },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        return () =>
            h(
                'div',
                (props.items as { value: string; label: string }[]).map(
                    (item) =>
                        h(
                            'button',
                            {
                                'data-tab': item.value,
                                'data-selected':
                                    item.value === props.modelValue,
                                onClick: () =>
                                    emit('update:modelValue', item.value),
                            },
                            item.label,
                        ),
                ),
            )
    },
})

const navigateTo = vi.fn()

const sections = [
    { id: 'access', label: 'Access', icon: 'i-lucide-key-round' },
    { id: 'links', label: 'Links', icon: 'i-lucide-link' },
]

function mountLayout(
    hasChanges = false,
    extraProps: Record<string, unknown> = {},
) {
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useDiscardConfirm', useDiscardConfirm)
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('useRouter', () => ({ back: vi.fn(), resolve: vi.fn() }))
    vi.stubGlobal('useSectionQuery', useSectionQuery)
    vi.stubGlobal('usePageBackTo', () => pageBackTo)
    vi.stubGlobal('onUnmounted', onUnmounted)
    vi.stubGlobal('onBeforeRouteLeave', (guard: () => Promise<boolean>) =>
        leaveGuards.push(guard),
    )
    return mount(SettingsLayout, {
        props: {
            sections,
            hasChanges,
            testIdPrefix: 'platform-settings',
            ...extraProps,
        },
        slots: {
            default: (scope: { activeSection: string }) =>
                h('p', { 'data-testid': 'active' }, scope.activeSection),
        },
        global: {
            stubs: {
                UNavigationMenu: NavStub,
                LayoutTabs: TabsStub,
                LayoutSaveBar: true,
                ConfirmDialog: true,
                UChip: { template: '<i data-testid="badge" />' },
            },
            mocks: { $t: (key: string) => key },
        },
    })
}

describe('SettingsLayout', () => {
    beforeEach(() => {
        route.query = {}
        leaveGuards.length = 0
        navigateTo.mockClear()
        pageBackTo.value = null
    })

    it('points the top-bar back at the section list while a section is open', async () => {
        const header = { owner: 1, to: '/platform/gyms' }
        pageBackTo.value = header
        const wrapper = mountLayout(false, { drillDown: true })
        expect(pageBackTo.value).toEqual(header)

        route.query = { section: 'links' }
        await wrapper.vm.$nextTick()
        expect(pageBackTo.value?.to).toBe('/platform/settings')
        expect(
            wrapper
                .find('[data-testid="platform-settings-drill-back"]')
                .exists(),
        ).toBe(false)

        route.query = {}
        await wrapper.vm.$nextTick()
        expect(pageBackTo.value).toEqual(header)

        route.query = { section: 'links' }
        await wrapper.vm.$nextTick()
        wrapper.unmount()
        expect(pageBackTo.value).toEqual(header)
    })

    it('opens the requested section and falls back to the first', async () => {
        const wrapper = mountLayout()
        expect(wrapper.get('[data-testid="active"]').text()).toBe('access')

        route.query = { section: 'links' }
        await wrapper.vm.$nextTick()
        expect(wrapper.get('[data-testid="active"]').text()).toBe('links')
        expect(wrapper.find('li[data-active="true"]').text()).toBe('Links')
    })

    it('switches sections from the phone tabs', async () => {
        route.query = { section: 'links' }
        const wrapper = mountLayout()
        expect(
            wrapper.get('[data-tab="links"]').attributes('data-selected'),
        ).toBe('true')

        await wrapper.get('[data-tab="access"]').trigger('click')
        expect(navigateTo).toHaveBeenCalledWith(
            { query: { section: 'access' } },
            { replace: true },
        )
    })

    it('lets the route change only without unsaved changes', async () => {
        mountLayout(false)
        await expect(leaveGuards[0]!()).resolves.toBe(true)
    })

    it('lists danger sections in their own group in the drill-down', () => {
        vi.stubGlobal('useRoute', () => route)
        vi.stubGlobal('useDiscardConfirm', useDiscardConfirm)
        vi.stubGlobal('navigateTo', navigateTo)
        vi.stubGlobal('onBeforeRouteLeave', () => {})
        vi.stubGlobal('usePageBackTo', () => pageBackTo)
        vi.stubGlobal('onUnmounted', onUnmounted)
        const wrapper = mount(SettingsLayout, {
            props: {
                sections: [
                    ...sections,
                    {
                        id: 'danger',
                        label: 'Delete',
                        icon: 'i-lucide-trash-2',
                        danger: true,
                    },
                ],
                hasChanges: false,
                testIdPrefix: 'gym',
                drillDown: true,
            },
            global: {
                stubs: {
                    UNavigationMenu: NavStub,
                    LayoutSaveBar: true,
                    ConfirmDialog: true,
                    LayoutListGroup: { template: '<ul><slot /></ul>' },
                    LayoutListRow: { template: '<li><slot /></li>' },
                },
                mocks: { $t: (key: string) => key },
            },
        })
        const groups = wrapper.findAll('ul.mb-4')
        expect(groups).toHaveLength(2)
        expect(groups[0]!.text()).not.toContain('Delete')
        expect(groups[1]!.text()).toContain('Delete')
    })

    it('reads and writes a custom query key', async () => {
        route.query = { tab: 'links' }
        const wrapper = mountLayout(false, { queryKey: 'tab' })
        expect(wrapper.get('[data-testid="active"]').text()).toBe('links')

        await wrapper.get('[data-tab="access"]').trigger('click')
        expect(navigateTo).toHaveBeenCalledWith(
            { query: { tab: 'access' } },
            { replace: true },
        )
    })

    it('guards leaving on unsaved changes outside the shown section', async () => {
        mountLayout(false, { unsavedChanges: true })
        const leaving = leaveGuards[0]!()
        await expect(
            Promise.race([leaving, Promise.resolve('pending')]),
        ).resolves.toBe('pending')
    })

    it('shows desktop tabs instead of the side navigation', () => {
        const wrapper = mountLayout(false, { desktopTabs: true })
        expect(wrapper.find('aside').exists()).toBe(false)
        expect(wrapper.findAll('[data-tab="access"]')).toHaveLength(2)
    })

    it('marks a section with a badge in the drill-down list', () => {
        const wrapper = mountLayout(false, {
            drillDown: true,
            sections: [sections[0], { ...sections[1], badge: true }],
        })
        const rows = wrapper.findAll(
            '[data-testid^="platform-settings-drill-"]',
        )
        expect(rows[0]!.find('[data-testid="badge"]').exists()).toBe(false)
        expect(rows[1]!.find('[data-testid="badge"]').exists()).toBe(true)
    })
})
