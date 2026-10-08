import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import InfoList from '~/components/layout/InfoList.vue'

vi.stubGlobal('useVersionCheck', () => ({
    appVersionLabel: '2.1.1',
    installedNotes: ref(''),
    installedBase: ref('2.1.1'),
    installedPublishedAt: ref(''),
    installedCommits: ref([]),
    repoUrl: ref(''),
    error: ref(null),
    loading: ref(false),
}))
vi.stubGlobal('useAppStatus', () => ({
    isHealthy: ref(true),
    onlineCount: ref(3),
}))

const linkStub = defineComponent({
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
        return () =>
            h(
                'a',
                {
                    href: attrs.to ?? attrs.href,
                    'data-testid': attrs['data-testid'],
                },
                slots.default?.(),
            )
    },
})

function createWrapper(gym: Record<string, string> | null) {
    return mount(InfoList, {
        props: { settings: {}, gym },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                NuxtLink: linkStub,
                UIcon: true,
                NotificationsUpdatePill: {
                    template: '<div><slot :props="{}" /></div>',
                },
                NotificationsReleaseNotesDialog: {
                    template:
                        '<div><slot name="activator" :props="{}" /></div>',
                },
            },
        },
    })
}

describe('LayoutInfoList', () => {
    it('shows a single legal notice that points to the gym when there is one', () => {
        const wrapper = createWrapper({ slug: 'hanau', name: 'DAV Hanau' })
        const imprints = wrapper.findAll('[data-testid="footer-imprint"]')

        expect(imprints).toHaveLength(1)
        expect(imprints[0]!.attributes('href')).toBe('/hanau/imprint')
        expect(imprints[0]!.text()).toContain('DAV Hanau')
    })

    it('falls back to the platform legal notice without a gym', () => {
        const wrapper = createWrapper(null)

        expect(
            wrapper.get('[data-testid="footer-imprint"]').attributes('href'),
        ).toBe('/imprint')
    })
})
