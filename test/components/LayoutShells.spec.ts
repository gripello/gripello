import { mount } from '@vue/test-utils'
import { onUnmounted, watch } from 'vue'
import PageHeader from '~/components/layout/PageHeader.vue'
import Panel from '~/components/layout/Panel.vue'
import ListRow from '~/components/layout/ListRow.vue'
import ListGroup from '~/components/layout/ListGroup.vue'
import { usePageBackTo } from '~/composables/useGoBack'
import Eyebrow from '~/components/layout/Eyebrow.vue'

vi.stubGlobal('usePageBackTo', usePageBackTo)
vi.stubGlobal('watch', watch)
vi.stubGlobal('onUnmounted', onUnmounted)

const stubs = {
    UButton: {
        props: ['to'],
        template: '<a :href="to" data-testid="page-back"><slot /></a>',
    },
    LayoutSectionHeader: {
        props: ['title'],
        template: '<h2>{{ title }}<slot name="actions" /></h2>',
    },
    NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

describe('layout shells', () => {
    it('PageHeader renders a back link only with backTo', () => {
        const plain = mount(PageHeader, {
            props: { title: 'T' },
            global: { stubs },
        })
        const back = mount(PageHeader, {
            props: { title: 'T', backTo: '/list', backLabel: 'Back' },
            global: { stubs },
        })

        expect(plain.find('[data-testid="page-back"]').exists()).toBe(false)
        expect(back.find('[data-testid="page-back"]').attributes('href')).toBe(
            '/list',
        )
        expect(back.text()).toContain('Back')
    })

    it('PageHeader lets a long title wrap beside inline actions', () => {
        const header = mount(PageHeader, {
            props: { title: 'T', inlineActions: true },
            slots: { actions: '<button>Go</button>' },
            global: { stubs },
        })
        expect(
            header.find('.page-header__title').element.parentElement?.className,
        ).toBe('min-w-0 break-words')
    })

    it('PageHeader hands its back target to the top bar while mounted', () => {
        const back = mount(PageHeader, {
            props: { title: 'T', backTo: '/judge' },
            global: { stubs },
        })
        expect(usePageBackTo().value?.to).toBe('/judge')
        back.unmount()
        expect(usePageBackTo().value).toBeNull()
    })

    it('Panel flush drops the body padding and keeps a header divider', () => {
        const flush = mount(Panel, {
            props: { title: 'Routes', flush: true },
            slots: { default: '<ul />' },
            global: { stubs: { ...stubs, USeparator: { template: '<hr />' } } },
        })
        const padded = mount(Panel, {
            props: { padding: 'sm' },
            slots: { default: 'body' },
            global: { stubs },
        })

        expect(flush.classes()).toContain('overflow-hidden')
        expect(flush.classes()).not.toContain('p-4')
        expect(flush.find('hr').exists()).toBe(true)
        expect(padded.classes()).toContain('p-3')
    })

    it('ListRow dense tightens the row padding', () => {
        const dense = mount(ListRow, {
            props: { dense: true },
            slots: { default: 'x' },
            global: { stubs },
        })
        expect(dense.find('div').classes()).toContain('min-h-13')
    })

    it('ListRow renders a label row with a tinted icon chip', () => {
        const row = mount(ListRow, {
            props: { as: 'label', icon: 'i-lucide-bell', iconActive: true },
            slots: { default: '<input type="checkbox" />' },
            global: { stubs: { ...stubs, UIcon: true } },
        })
        expect(row.find('label').classes()).toContain('cursor-pointer')
        expect(row.find('label > span').classes()).toContain('bg-primary/10')
    })

    it('ListGroup flush drops its own box inside a panel', () => {
        const flush = mount(ListGroup, { props: { flush: true } })
        const boxed = mount(ListGroup)
        expect(flush.classes()).not.toContain('ring')
        expect(boxed.classes()).toContain('ring')
    })

    it('Panel shows a header only with a title', () => {
        const titled = mount(Panel, {
            props: { title: 'Routes' },
            slots: { default: 'body', actions: '<button />' },
            global: { stubs },
        })
        const bare = mount(Panel, {
            slots: { default: 'body' },
            global: { stubs },
        })

        expect(titled.find('h2').text()).toBe('Routes')
        expect(titled.find('button').exists()).toBe(true)
        expect(bare.find('h2').exists()).toBe(false)
        expect(bare.element.tagName).toBe('SECTION')
    })

    it('ListRow becomes a link with to', () => {
        const linked = mount(ListRow, {
            props: { to: '/x' },
            slots: { default: 'row' },
            global: { stubs },
        })
        const plain = mount(ListRow, {
            slots: { default: 'row' },
            global: { stubs },
        })

        expect(linked.find('a').attributes('href')).toBe('/x')
        expect(plain.find('a').exists()).toBe(false)
        expect(plain.text()).toBe('row')
    })

    it('Eyebrow renders the requested tag', () => {
        expect(
            mount(Eyebrow, { props: { as: 'p' }, slots: { default: 'Group' } })
                .element.tagName,
        ).toBe('P')
    })
})
