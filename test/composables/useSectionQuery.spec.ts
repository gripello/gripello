import { reactive } from 'vue'
import { useSectionQuery } from '~/composables/useSectionQuery'

const route = reactive({
    path: '/account/settings',
    query: {} as Record<string, string>,
})
const back = vi.fn()
const navigateTo = vi.fn()

function setup(previous: string | null) {
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({
        back,
        resolve: (to: string) => {
            const url = new URL(to, 'http://x')
            return {
                path: url.pathname,
                query: Object.fromEntries(url.searchParams),
            }
        },
    }))
    vi.stubGlobal('navigateTo', navigateTo)
    window.history.replaceState({ back: previous }, '')
    return useSectionQuery('tab')
}

beforeEach(() => {
    back.mockClear()
    navigateTo.mockClear()
    route.query = {}
})

describe('useSectionQuery', () => {
    it('pushes when opening a section from the list', () => {
        setup(null).select('security')
        expect(navigateTo).toHaveBeenCalledWith(
            { query: { tab: 'security' } },
            { replace: false },
        )
    })

    it('replaces when switching between sections, so history does not pile up', () => {
        route.query = { tab: 'profile' }
        setup(null).select('security')
        expect(navigateTo).toHaveBeenCalledWith(
            { query: { tab: 'security' } },
            { replace: true },
        )
    })

    it('steps back to the list entry it came from', () => {
        route.query = { tab: 'security' }
        setup('/account/settings').backToList()
        expect(back).toHaveBeenCalled()
        expect(navigateTo).not.toHaveBeenCalled()
    })

    it('replaces with the list when the section was opened directly', () => {
        route.query = { tab: 'security' }
        setup('/account').backToList()
        expect(back).not.toHaveBeenCalled()
        expect(navigateTo).toHaveBeenCalledWith(
            { query: {} },
            { replace: true },
        )
    })
})
