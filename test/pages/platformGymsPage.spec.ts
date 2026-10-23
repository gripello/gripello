import { readFileSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, reactive, ref, watch } from 'vue'
import GymsPage from '~/pages/platform/gyms/index.vue'
import { createGym } from '~/api/gyms'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/gyms', () => ({ createGym: vi.fn(), updateGym: vi.fn() }))
vi.mock('~/api/members', () => ({ findRole: vi.fn(), inviteMember: vi.fn() }))

describe('platform gyms page', () => {
    it('keeps New gym in the page header instead of floating it on phones', () => {
        const source = readFileSync('app/pages/platform/gyms/index.vue', 'utf8')
        expect(source).not.toMatch(/max-lg:fixed/)
        expect(source).toMatch(/<LayoutPageHeader[^>]*inline-actions/)
        expect(source).toMatch(
            /<template #actions>\s+<UButton[\s\S]+?data-testid="platform-gym-create"/,
        )
    })

    it('puts a taken slug on the field and keeps the dialog open', async () => {
        const setErrors = vi.fn()
        const notifyError = vi.fn()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('definePageMeta', () => {})
        vi.stubGlobal('useHead', () => {})
        vi.stubGlobal('usePlatformGyms', async () => ({
            data: ref([]),
            error: ref(null),
            refresh: vi.fn(),
        }))
        vi.stubGlobal('usePlatformLive', () => {})
        vi.stubGlobal('useModerationSummary', () => ({ summary: ref(null) }))
        vi.stubGlobal('useNotification', () => ({
            success: vi.fn(),
            error: notifyError,
        }))
        vi.stubGlobal('useAsyncAction', useAsyncAction)
        vi.mocked(createGym).mockRejectedValue({
            status: 400,
            response: {
                data: { slug: { code: 'validation_slug_used', message: '' } },
            },
        })
        const wrapper = mount(
            defineComponent({
                components: { GymsPage },
                template: '<Suspense><GymsPage /></Suspense>',
            }),
            {
                global: {
                    mocks: { $t: (key: string) => key },
                    stubs: {
                        LayoutDialogShell: dialogShellStub,
                        LayoutPageHeader: true,
                        ConfirmDialog: true,
                        UForm: {
                            name: 'UForm',
                            emits: ['submit'],
                            setup(
                                _: unknown,
                                { expose }: { expose: (api: object) => void },
                            ) {
                                expose({ setErrors })
                            },
                            template: '<form><slot /></form>',
                        },
                    },
                },
            },
        )
        await flushPromises()

        const form = wrapper.findComponent({ name: 'UForm' })
        form.vm.$emit('submit')
        form.vm.$emit('submit')
        await flushPromises()

        expect(createGym).toHaveBeenCalledTimes(1)
        expect(setErrors).toHaveBeenCalledWith([
            { name: 'slug', message: 'gymOnboarding.slugTaken' },
        ])
        expect(notifyError).not.toHaveBeenCalled()
    })
})
