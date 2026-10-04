import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import FootBar from '~/components/layout/FootBar.vue'
import LegalLinks from '~/components/layout/LegalLinks.vue'

vi.stubGlobal('useVersionCheck', () => ({
    appVersionLabel: ref('2.1.1'),
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
                    href: attrs.href ?? attrs.to,
                    'data-testid': attrs['data-testid'],
                },
                slots.default?.(),
            )
    },
})

const menuStub = defineComponent({
    props: ['items'],
    setup(props, { slots }) {
        return () =>
            h('div', { 'data-items': JSON.stringify(props.items) }, [
                slots.default?.(),
                slots.status?.(),
                slots['version-label']?.(),
                slots['contact-label']?.(),
            ])
    },
})

function createWrapper(collapsed = false) {
    return mount(FootBar, {
        props: {
            gymSlug: 'gym',
            settings: { contact_email: 'a@b.c' },
            collapsed,
        },
        global: {
            mocks: { $t: (key: string) => key },
            components: { LayoutLegalLinks: LegalLinks },
            stubs: {
                ULink: linkStub,
                UChip: true,
                UButton: true,
                UDropdownMenu: menuStub,
                NotificationsReleaseNotesDialog: true,
                NotificationsUpdatePill: true,
            },
        },
    })
}

const menuItems = (wrapper: ReturnType<typeof createWrapper>) =>
    JSON.parse(wrapper.get('[data-items]').attributes('data-items')!).flat()

describe('LayoutFootBar', () => {
    it('keeps the legal links visible and puts status, version and contact in the menu', () => {
        const wrapper = createWrapper()

        expect(
            wrapper.get('[data-testid="footer-imprint"]').attributes('href'),
        ).toBe('/gym/imprint')
        expect(
            wrapper.get('[data-testid="footer-privacy"]').attributes('href'),
        ).toBe('/gym/privacy')
        expect(wrapper.get('[data-testid="footer-health"]').text()).toBe(
            'notifications.success.health',
        )
        expect(wrapper.get('[data-testid="footer-version"]').text()).toBe(
            '2.1.1',
        )
        expect(menuItems(wrapper)).toContainEqual(
            expect.objectContaining({ href: 'mailto:a@b.c' }),
        )
    })

    it('moves the legal links into the menu when the sidebar is collapsed', () => {
        const wrapper = createWrapper(true)

        expect(wrapper.find('[data-testid="footer-imprint"]').exists()).toBe(
            false,
        )
        expect(menuItems(wrapper)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ to: '/gym/imprint' }),
                expect.objectContaining({ to: '/gym/privacy' }),
            ]),
        )
    })
})
