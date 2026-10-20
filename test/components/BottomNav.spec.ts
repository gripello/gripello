import { readFileSync } from 'node:fs'
import path from 'node:path'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import BottomNav from '~/components/layout/BottomNav.vue'

const authRecord = ref<Record<string, string> | null>(null)
vi.stubGlobal('useAuthRecord', () => authRecord)
vi.stubGlobal('useRoute', () => ({
    path: '/e2e/routes',
    params: { gym: 'e2e' },
}))
vi.stubGlobal('useGymCookie', () => ref('e2e'))
vi.stubGlobal('useGym', () => ({ slug: computed(() => 'e2e') }))
vi.stubGlobal('usePermissions', () => ({ can: () => true }))
vi.stubGlobal('useModerationSummary', () => ({
    badges: computed(() => ({ moderation: 3 })),
}))
vi.stubGlobal('routeGymSlug', (params: { gym?: string }) => params.gym ?? '')
vi.stubGlobal('navTestId', (path: string) => path.replace(/\W/g, ''))

const UNavigationMenu = defineComponent({
    props: { items: { type: Array, default: () => [] } },
    setup(props) {
        return () =>
            h(
                'ul',
                (
                    props.items as {
                        label: string
                        avatar?: { text: string }
                    }[]
                ).map((item) =>
                    h(
                        'li',
                        item.avatar ? `avatar:${item.avatar.text}` : item.label,
                    ),
                ),
            )
    },
})

describe('BottomNav', () => {
    it('follows sign-in, avatar changes and sign-out without a reload', async () => {
        const wrapper = mount(BottomNav, {
            global: {
                mocks: { $t: (key: string) => key },
                stubs: { UNavigationMenu },
            },
        })
        const lastTab = () => wrapper.findAll('li').at(-1)!.text()

        expect(lastTab()).toBe('routes.login')

        authRecord.value = { id: 'u1', firstname: 'Ada', name: 'Lovelace' }
        await nextTick()
        expect(lastTab()).toBe('avatar:AL')

        authRecord.value = { id: 'u1', firstname: 'Grace', name: 'Hopper' }
        await nextTick()
        expect(lastTab()).toBe('avatar:GH')

        authRecord.value = null
        await nextTick()
        expect(lastTab()).toBe('routes.login')
    })
})

describe('BottomNav markers', () => {
    const source = readFileSync(
        path.resolve(
            import.meta.dirname,
            '../../app/components/layout/BottomNav.vue',
        ),
        'utf8',
    )

    it('gives the avatar no extra ring', () => {
        expect(source).not.toContain('ring-2 ring-primary')
    })

    it('marks the active tab with a line on the top edge instead of a pill', () => {
        expect(source).toMatch(
            /v-if="active && !item\.scan"\s+class="bottom-nav__line"/,
        )
        expect(source).not.toMatch(/\.is-active \{[^}]*background/)
    })
})

describe('BottomNav while typing', () => {
    it('hides on touch screens while a text field has focus', () => {
        const css = readFileSync(
            path.resolve(import.meta.dirname, '../../app/assets/css/main.css'),
            'utf8',
        )
        expect(css).toMatch(
            /@media \(pointer: coarse\) \{\s+body:has\([\s\S]+?textarea[\s\S]+?\):focus\s+\)\s+\.bottom-nav \{\s+display: none;/,
        )
    })
})
