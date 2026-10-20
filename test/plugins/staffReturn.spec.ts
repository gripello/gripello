import { ref } from 'vue'
import type { RouteLocationNormalized } from 'vue-router'
import { routeGymSlug } from '~/composables/useGym'

type Hook = (to: RouteLocationNormalized, from: RouteLocationNormalized) => void

const route = (fullPath: string, matched = true) =>
    ({
        path: fullPath.split('?')[0],
        fullPath,
        params: { gym: fullPath.split('/')[1] },
        matched: matched ? [{}] : [],
    }) as unknown as RouteLocationNormalized

async function startPlugin() {
    let afterEach!: Hook
    const returnTo = ref<string | null>(null)
    vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup)
    vi.stubGlobal('routeGymSlug', routeGymSlug)
    vi.stubGlobal('useStaffReturnTo', () => returnTo)
    vi.stubGlobal('useRouter', () => ({
        afterEach: (hook: Hook) => (afterEach = hook),
    }))
    const { default: plugin } = await import('~/plugins/staff-return.client')
    ;(plugin as unknown as () => void)()
    return { afterEach, returnTo }
}

describe('staff return plugin', () => {
    it('remembers the climber page only when entering the staff tools', async () => {
        const { afterEach, returnTo } = await startPlugin()

        afterEach(route('/gym/manage'), route('/gym/routes?q=x'))
        expect(returnTo.value).toBe('/gym/routes?q=x')

        afterEach(route('/gym/manage/routes'), route('/gym/manage'))
        expect(returnTo.value).toBe('/gym/routes?q=x')

        afterEach(route('/gym/map'), route('/gym/manage/routes'))
        expect(returnTo.value).toBe('/gym/routes?q=x')

        afterEach(route('/gym/admin'), route('/', false))
        expect(returnTo.value).toBe('/gym/routes?q=x')

        afterEach(route('/gym/admin'), route('/gym/map'))
        expect(returnTo.value).toBe('/gym/map')
    })
})
