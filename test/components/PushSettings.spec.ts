import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import PushSettings from '~/components/account/PushSettings.vue'
import LayoutListGroup from '~/components/layout/ListGroup.vue'
import LayoutListRow from '~/components/layout/ListRow.vue'

const getPrefs = vi.fn()
const updatePrefs = vi.fn()
vi.mock('~/api/notifications', () => ({
    getNotificationPrefs: () => getPrefs(),
    putNotificationPrefs: (...args: unknown[]) => updatePrefs(...args),
}))
vi.mock('~/api/routes', () => ({ listWallsById: async () => [] }))

const switchStub = {
    props: ['modelValue', 'disabled'],
    template:
        '<button :data-on="modelValue" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />',
}

function mountSettings(user: Record<string, unknown> = {}) {
    globalThis.__AUTH_STORE__ = {
        record: { id: 'me', ...user },
        token: 't',
        save: vi.fn(),
    }
    return mount(PushSettings, {
        global: {
            components: { LayoutListGroup, LayoutListRow },
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutEyebrow: { template: '<div><slot /></div>' },
                UIcon: true,
                UBadge: true,
                USwitch: switchStub,
                UButton: {
                    template:
                        '<button @click="$emit(\'click\')"><slot /></button>',
                },
            },
        },
    })
}

describe('PushSettings', () => {
    beforeEach(() => {
        getPrefs.mockReset()
        updatePrefs.mockReset().mockResolvedValue({})
        vi.stubGlobal('usePushSubscription', () => ({
            topics: ref([{ key: 'social' }, { key: 'achievements' }]),
            loadError: ref(false),
            refresh: vi.fn(),
            devices: ref([]),
            currentEndpoint: ref(''),
            thisDeviceAdded: ref(true),
            available: ref(true),
            busy: ref(false),
            support: ref('supported'),
        }))
        vi.stubGlobal('usePermissions', () => ({
            memberships: ref([]),
            isPlatformAdmin: computed(() => false),
        }))
        vi.stubGlobal('useFollowedWalls', () => ({
            followed: ref([]),
            setFollowing: vi.fn(),
        }))
        vi.stubGlobal('useNotification', () => ({ error: vi.fn() }))
        vi.stubGlobal('useAsyncAction', () => ({ run: vi.fn() }))
    })

    it('keeps topic switches disabled until the saved prefs are loaded', async () => {
        let resolvePrefs: (prefs: unknown) => void = () => undefined
        getPrefs.mockReturnValue(new Promise((done) => (resolvePrefs = done)))
        const wrapper = mountSettings({
            notification_prefs: { push: { social: false } },
        })
        const social = wrapper.get('[data-testid="push-topic-social"]')
        expect(social.attributes('disabled')).toBeDefined()
        expect(social.attributes('data-on')).toBe('false')

        resolvePrefs({ push: { social: false } })
        await flushPromises()
        expect(social.attributes('disabled')).toBeUndefined()
        await wrapper
            .get('[data-testid="push-topic-achievements"]')
            .trigger('click')
        expect(updatePrefs).toHaveBeenCalledWith({
            push: { social: false, achievements: false },
        })
    })

    it('shows the error state when the prefs fail to load and retries', async () => {
        getPrefs.mockRejectedValueOnce(new Error('offline'))
        const wrapper = mountSettings()
        await flushPromises()
        expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
        expect(updatePrefs).not.toHaveBeenCalled()

        getPrefs.mockResolvedValueOnce({})
        await wrapper.get('[data-testid="load-error-retry"]').trigger('click')
        await flushPromises()
        expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
        expect(
            wrapper
                .get('[data-testid="push-topic-social"]')
                .attributes('disabled'),
        ).toBeUndefined()
    })
})
