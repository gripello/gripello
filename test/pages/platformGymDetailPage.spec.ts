import { flushPromises, mount } from '@vue/test-utils'
import {
    computed,
    defineComponent,
    reactive,
    ref,
    useTemplateRef,
    watch,
} from 'vue'
import GymDetailPage from '~/pages/platform/gyms/[id].vue'
import { useReauth } from '~/composables/useReauth'
import { deleteGym } from '~/api/gyms'
import { reauthenticate } from '~/api/account'

vi.mock('~/api/gyms', () => ({
    getGymById: vi.fn(),
    updateGym: vi.fn(),
    deleteGym: vi.fn(),
}))
vi.mock('~/api/platform', () => ({ setGymFeatures: vi.fn() }))
vi.mock('~/api/account', () => ({ reauthenticate: vi.fn() }))

describe('platform gym detail page', () => {
    it('reloads the gym on profile and trial changes', async () => {
        let refreshWhen: ((event: { kind: string }) => boolean) | undefined
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('useTemplateRef', useTemplateRef)
        vi.stubGlobal('definePageMeta', () => {})
        vi.stubGlobal('useHead', () => {})
        vi.stubGlobal('useRoute', () => ({ params: { id: 'g1' }, query: {} }))
        vi.stubGlobal('useAsyncData', async () => ({
            data: ref({ id: 'g1', slug: 'hall', name: 'Hall' }),
            error: ref(null),
            refresh: vi.fn(),
        }))
        vi.stubGlobal(
            'useLiveRefresh',
            (
                _topic: string,
                _refresh: unknown,
                options: { when: typeof refreshWhen },
            ) => (refreshWhen = options.when),
        )
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: vi.fn(),
        }))
        vi.stubGlobal('useModerationSummary', () => ({ summary: ref(null) }))
        vi.stubGlobal('useHydrated', () => ref(false))
        mount(
            defineComponent({
                components: { GymDetailPage },
                template: '<Suspense><GymDetailPage /></Suspense>',
            }),
            {
                global: {
                    mocks: { $t: (key: string) => key },
                    stubs: {
                        LayoutPageHeader: true,
                        AdminGymSettingsForm: true,
                        ConfirmDialog: true,
                    },
                },
            },
        )
        await flushPromises()

        expect(refreshWhen?.({ kind: 'gym.updated' })).toBe(true)
        expect(refreshWhen?.({ kind: 'gym.trial_changed' })).toBe(true)
        expect(refreshWhen?.({ kind: 'member.created' })).toBe(false)
    })

    it('confirms the admin password before deleting the gym', async () => {
        const order: string[] = []
        vi.mocked(reauthenticate).mockImplementation(async () => {
            order.push('reauth')
        })
        vi.mocked(deleteGym).mockImplementation(async () => {
            order.push('delete')
            return null as never
        })
        vi.stubGlobal('useReauth', useReauth)
        vi.stubGlobal('navigateTo', vi.fn())
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: async (action: () => Promise<unknown>) =>
                action().catch(() => undefined),
        }))
        const wrapper = mount(
            defineComponent({
                components: { GymDetailPage },
                template: '<Suspense><GymDetailPage /></Suspense>',
            }),
            {
                global: {
                    mocks: { $t: (key: string) => key },
                    stubs: {
                        LayoutPageHeader: true,
                        AdminGymSettingsForm: true,
                        ConfirmDialog: {
                            emits: ['confirm'],
                            template: `<div><slot /><button data-testid="confirm-stub"
                                @click="$emit('confirm')" /></div>`,
                        },
                        UserReauthField: {
                            props: ['modelValue'],
                            emits: ['update:modelValue'],
                            template: `<input v-bind="$attrs"
                                @input="$emit('update:modelValue', $event.target.value)" />`,
                        },
                    },
                },
            },
        )
        await flushPromises()
        await wrapper
            .get('[data-testid="platform-gym-delete-password"]')
            .setValue('secret')
        const confirm = wrapper.findAll('[data-testid="confirm-stub"]').at(-1)!
        await confirm.trigger('click')
        await flushPromises()

        expect(reauthenticate).toHaveBeenCalledWith('secret')
        expect(order).toEqual(['reauth', 'delete'])
    })
})
