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
vi.stubGlobal('usePbFileUrl', (_: unknown, file?: string) =>
    file ? `/files/${file}` : '',
)

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
