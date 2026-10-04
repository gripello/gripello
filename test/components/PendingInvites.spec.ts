import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import PendingInvites from '~/components/admin/PendingInvites.vue'

const invite = {
    id: 'inv1',
    gym: 'gym-a',
    role: 'setter',
    email: 'new@example.com',
    firstname: 'New',
    name: 'Setter',
    expires_at: '2026-10-11 12:00:00.000Z',
    expand: { role: { name: 'routesetter' } },
}

const getFullList = vi.fn()
const remove = vi.fn()
const send = vi.fn()

function mountInvites() {
    return mount(PendingInvites, {
        props: { gymId: 'gym-a' },
        global: {
            stubs: {
                UTooltip: { template: '<div><slot /></div>' },
                UButton: {
                    emits: ['click'],
                    template:
                        '<button @click="$emit(\'click\')"><slot /></button>',
                },
            },
        },
    })
}

describe('AdminPendingInvites', () => {
    beforeEach(() => {
        getFullList.mockReset().mockResolvedValue([invite])
        remove.mockReset().mockResolvedValue(true)
        send.mockReset().mockResolvedValue(null)
        globalThis.__POCKETBASE_CLIENT__ = {
            filter: (query: string) => query,
            collection: () => ({ getFullList, delete: remove }),
            send,
        }
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: async (action: () => Promise<unknown>) => action(),
        }))
        vi.stubGlobal('usePbSubscription', () => ({ subscribe: vi.fn() }))
    })

    it('lists pending invites with role', async () => {
        const wrapper = mountInvites()
        await flushPromises()
        const row = wrapper.find(
            '[data-testid="pending-invite-new@example.com"]',
        )
        expect(row.text()).toContain('new@example.com')
        expect(row.text()).toContain('routesetter')
    })

    it('renders nothing without invites', async () => {
        getFullList.mockResolvedValue([])
        const wrapper = mountInvites()
        await flushPromises()
        expect(wrapper.find('[data-testid="pending-invites"]').exists()).toBe(
            false,
        )
    })

    it('resends with the same address and role', async () => {
        const wrapper = mountInvites()
        await flushPromises()
        await wrapper
            .find('[data-testid="pending-invite-resend"]')
            .trigger('click')
        await flushPromises()
        expect(send).toHaveBeenCalledWith('/api/gyms/gym-a/members', {
            method: 'POST',
            body: {
                email: 'new@example.com',
                role: 'setter',
                firstname: 'New',
                name: 'Setter',
            },
            requestKey: null,
        })
    })

    it('revokes by deleting the invite and reloads', async () => {
        const wrapper = mountInvites()
        await flushPromises()
        await wrapper
            .find('[data-testid="pending-invite-revoke"]')
            .trigger('click')
        await flushPromises()
        expect(remove).toHaveBeenCalledExactlyOnceWith('inv1')
        expect(getFullList).toHaveBeenCalledTimes(2)
    })
})
