import { mount } from '@vue/test-utils'
import PageHeader from '~/components/layout/PageHeader.vue'
import Panel from '~/components/layout/Panel.vue'
import ListRow from '~/components/layout/ListRow.vue'
import Eyebrow from '~/components/layout/Eyebrow.vue'

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
