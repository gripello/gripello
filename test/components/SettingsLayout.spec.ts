import { defineComponent, h, reactive } from 'vue'
import { mount } from '@vue/test-utils'
import SettingsLayout from '~/components/settings/Layout.vue'
import { useDiscardConfirm } from '~/composables/useDiscardConfirm'

const route = reactive({ query: {} as Record<string, string> })
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

const sections = [
    { id: 'access', label: 'Access', icon: 'i-lucide-key-round' },
    { id: 'links', label: 'Links', icon: 'i-lucide-link' },
]

function mountLayout(hasChanges = false) {
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useDiscardConfirm', useDiscardConfirm)
    vi.stubGlobal('onBeforeRouteLeave', (guard: () => Promise<boolean>) =>
        leaveGuards.push(guard),
    )
    return mount(SettingsLayout, {
        props: { sections, hasChanges, testIdPrefix: 'platform-settings' },
        slots: {
            default: (scope: { activeSection: string }) =>
                h('p', { 'data-testid': 'active' }, scope.activeSection),
        },
        global: {
            stubs: {
                UNavigationMenu: NavStub,
                LayoutSaveBar: true,
                ConfirmDialog: true,
            },
            mocks: { $t: (key: string) => key },
        },
    })
}

describe('SettingsLayout', () => {
    beforeEach(() => {
        route.query = {}
        leaveGuards.length = 0
    })

    it('opens the requested section and falls back to the first', async () => {
        const wrapper = mountLayout()
        expect(wrapper.get('[data-testid="active"]').text()).toBe('access')

        route.query = { section: 'links' }
        await wrapper.vm.$nextTick()
        expect(wrapper.get('[data-testid="active"]').text()).toBe('links')
        expect(wrapper.find('li[data-active="true"]').text()).toBe('Links')
    })

    it('lets the route change only without unsaved changes', async () => {
        mountLayout(false)
        await expect(leaveGuards[0]!()).resolves.toBe(true)
    })
})
