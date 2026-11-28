import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import LandingPage from '~/pages/index.vue'
import { isInstalledApp } from '~/utils/native'

vi.mock('~/api/gyms', () => ({ listGyms: vi.fn(async () => []) }))
vi.mock('~/utils/native', () => ({ isInstalledApp: vi.fn(() => true) }))

const navigateTo = vi.fn()

async function open({
    hydrating = true,
    cookieGym = { id: 'g1', slug: 'boulderhaus' } as object | null,
    referrer = '',
} = {}) {
    vi.stubGlobal('useNuxtApp', () => ({ isHydrating: hydrating }))
    vi.stubGlobal('useGym', () => ({ gym: ref(cookieGym) }))
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(referrer)
    mount(
        defineComponent({
            components: { LandingPage },
            template: '<Suspense><LandingPage /></Suspense>',
        }),
        {
            global: {
                mocks: { $t: (key: string) => key },
                stubs: { LayoutPageHeader: true, LayoutEmptyState: true },
            },
        },
    )
    await flushPromises()
}

describe('landing page on app launch', () => {
    beforeEach(() => {
        navigateTo.mockReset()
        vi.mocked(isInstalledApp).mockReturnValue(true)
        vi.stubGlobal('navigateTo', navigateTo)
        vi.stubGlobal('useGymCookie', () => ref('boulderhaus'))
        vi.stubGlobal('usePermissions', () => ({
            gymMemberships: ref([]),
            isPlatformAdmin: ref(false),
        }))
        vi.stubGlobal('useSeoMeta', () => {})
    })

    it('reopens the last gym when the installed app starts on /', async () => {
        await open()
        expect(navigateTo).toHaveBeenCalledWith('/boulderhaus', {
            replace: true,
        })
    })

    it('keeps the picker when someone navigates to / inside the app', async () => {
        await open({ hydrating: false })
        await open({ referrer: 'https://gripello.app/boulderhaus' })
        expect(navigateTo).not.toHaveBeenCalled()
    })

    it('keeps the picker without a known gym or in a browser tab', async () => {
        await open({ cookieGym: null })
        vi.mocked(isInstalledApp).mockReturnValue(false)
        await open()
        expect(navigateTo).not.toHaveBeenCalled()
    })
})
