import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import Bell from '~/components/notifications/Bell.vue'

const items = ref<Record<string, unknown>[]>([])
const loaded = ref(false)
const failed = ref(false)
const refresh = vi.fn()
const markRead = vi.fn()
const navigate = vi.fn()

function mountBell() {
    return mount(Bell, {
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UPopover: {
                    template: '<div><slot /><slot name="content" /></div>',
                },
                UButton: {
                    template: '<button v-bind="$attrs"><slot /></button>',
                },
                UChip: { template: '<span><slot /></span>' },
                UIcon: true,
                USeparator: true,
                LayoutLoadError: {
                    props: ['card'],
                    emits: ['retry'],
                    template:
                        '<div data-testid="load-error" :data-card="card" @click="$emit(\'retry\')" />',
                },
                LayoutLoadingState: {
                    template: '<div data-testid="loading-state" />',
                },
            },
        },
    })
}

describe('NotificationsBell', () => {
    beforeEach(() => {
        items.value = []
        loaded.value = false
        failed.value = false
        refresh.mockReset()
        markRead.mockReset()
        navigate.mockReset()
        vi.stubGlobal('useAuthStore', () => ({ isValid: true }))
        vi.stubGlobal('useNotificationQueue', () => ({
            items,
            loaded,
            failed,
            unreadCount: ref(0),
            refresh,
            applyEvent: vi.fn(),
            markRead,
            markAllRead: vi.fn(),
            dismiss: vi.fn(),
        }))
        vi.stubGlobal('useNotification', () => ({
            error: vi.fn(),
            announce: vi.fn(),
        }))
        vi.stubGlobal('usePushOffer', () => ({
            offered: ref(false),
            turnOn: vi.fn(),
        }))
        vi.stubGlobal('useRealtime', vi.fn())
        vi.stubGlobal('navigateTo', navigate)
    })

    it('shows skeletons, not "no notifications", while loading', () => {
        const wrapper = mountBell()
        expect(wrapper.find('[data-testid="loading-state"]').exists()).toBe(
            true,
        )
        expect(
            wrapper.find('[data-testid="notification-empty"]').exists(),
        ).toBe(false)
    })

    it('offers a retry when the load failed', async () => {
        failed.value = true
        const wrapper = mountBell()
        const error = wrapper.get('[data-testid="load-error"]')
        expect(error.attributes('data-card')).toBe('false')
        expect(
            wrapper.find('[data-testid="notification-empty"]').exists(),
        ).toBe(false)
        refresh.mockClear()
        await error.trigger('click')
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('says "no notifications" only after a successful load', () => {
        loaded.value = true
        const wrapper = mountBell()
        expect(
            wrapper.find('[data-testid="notification-empty"]').exists(),
        ).toBe(true)
    })

    it('navigates without waiting for the read receipt', async () => {
        loaded.value = true
        items.value = [
            {
                id: 'n1',
                type: 'report_filed',
                read: false,
                created: '',
                url: '/x',
            },
        ]
        markRead.mockReturnValue(new Promise(() => {}))
        const wrapper = mountBell()
        await wrapper
            .get('[data-testid="notification-item-n1"]')
            .trigger('click')
        await flushPromises()
        expect(markRead).toHaveBeenCalledWith('n1')
        expect(navigate).toHaveBeenCalledWith('/x')
    })
})
