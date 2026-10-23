import { flushPromises, mount } from '@vue/test-utils'
import SessionList from '~/components/account/SessionList.vue'
import LayoutListGroup from '~/components/layout/ListGroup.vue'
import LayoutListRow from '~/components/layout/ListRow.vue'
import { AuthStore } from '~/composables/authStore'

const tokenFor = (sid: string) => `x.${btoa(JSON.stringify({ sid }))}.y`
const token = tokenFor('here')
let store: AuthStore
const getFullList = vi.fn()
const remove = vi.fn()
const send = vi.fn()
vi.mock('~/api/account', () => ({
    listSessions: () => getFullList(),
    revokeSession: (id: string) => remove(id),
    signOutOtherSessions: () => send(),
}))
const session = (id: string, userAgent: string, lastSeen: string) => ({
    id,
    user: 'me',
    method: 'password',
    user_agent: userAgent,
    ip: '10.0.0.1',
    last_seen: lastSeen,
    created: lastSeen,
})

function mountList() {
    return mount(SessionList, {
        global: {
            components: { LayoutListGroup, LayoutListRow },
            stubs: {
                UIcon: true,
                UBadge: {
                    props: ['label'],
                    template: '<span>{{ label }}</span>',
                },
                ConfirmDialog: {
                    emits: ['confirm'],
                    template:
                        '<button data-testid="confirm" @click="$emit(\'confirm\')" />',
                },
                UButton: {
                    emits: ['click'],
                    template:
                        '<button @click="$emit(\'click\')"><slot /></button>',
                },
            },
        },
    })
}

describe('SessionList', () => {
    beforeEach(() => {
        getFullList
            .mockReset()
            .mockResolvedValue([
                session(
                    'other',
                    'Mozilla/5.0 (iPhone) Safari/604.1',
                    '2026-10-08T10:00:00Z',
                ),
                session(
                    'here',
                    'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0',
                    '2026-10-07T10:00:00Z',
                ),
            ])
        remove.mockReset().mockResolvedValue(true)
        send.mockReset().mockResolvedValue(null)
        store = new AuthStore('')
        store.save(token, { id: 'me' })
        globalThis.__AUTH_STORE__ = store
        vi.stubGlobal('useAccountChanges', vi.fn())
        vi.stubGlobal('useNotification', () => ({ error: vi.fn() }))
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: async (action: () => Promise<unknown>) => action(),
        }))
    })

    it('lists this device first and marks it', async () => {
        const wrapper = mountList()
        await flushPromises()
        const rows = wrapper.findAll('[data-testid="session-row"]')
        expect(rows[0]!.text()).toContain('Firefox · Linux')
        expect(rows[0]!.text()).toContain('account.sessions.thisDevice')
        expect(rows[1]!.text()).toContain('Safari · iPhone')
        expect(rows[0]!.find('[data-testid="session-revoke"]').exists()).toBe(
            false,
        )
    })

    it('revokes another device by deleting its session', async () => {
        const wrapper = mountList()
        await flushPromises()
        await wrapper.get('[data-testid="session-revoke"]').trigger('click')
        await flushPromises()
        expect(remove).toHaveBeenCalledWith('other')
        expect(wrapper.findAll('[data-testid="session-row"]')).toHaveLength(1)
    })

    it('signs out every other device', async () => {
        const wrapper = mountList()
        await flushPromises()
        await wrapper.get('[data-testid="confirm"]').trigger('click')
        await flushPromises()
        expect(send).toHaveBeenCalled()
        expect(wrapper.findAll('[data-testid="session-row"]')).toHaveLength(1)
    })

    it('follows a new session after the token changes', async () => {
        const wrapper = mountList()
        await flushPromises()
        store.save(tokenFor('other'), { id: 'me' })
        await flushPromises()
        const rows = wrapper.findAll('[data-testid="session-row"]')
        expect(rows[1]!.text()).toContain('account.sessions.thisDevice')
        expect(rows[0]!.text()).not.toContain('account.sessions.thisDevice')
    })
})
