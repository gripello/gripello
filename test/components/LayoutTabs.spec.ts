import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Tabs from '~/components/layout/Tabs.vue'

describe('LayoutTabs', () => {
    it('scrolls the active tab into view when it changes', async () => {
        vi.stubGlobal('nextTick', nextTick)
        const tabsRef = ref<{ $el: Element }>()
        vi.stubGlobal('useTemplateRef', () => tabsRef)
        const scrollIntoView = vi.fn()
        const wrapper = mount(Tabs, {
            props: {
                items: [
                    { label: 'A', value: 'a' },
                    { label: 'B', value: 'b' },
                ],
                modelValue: 'a',
            },
            global: {
                stubs: {
                    UTabs: {
                        props: ['modelValue'],
                        template:
                            '<div><button v-for="v in [\'a\', \'b\']" :key="v" role="tab" :data-state="v === modelValue ? \'active\' : \'inactive\'" /></div>',
                    },
                },
            },
        })
        tabsRef.value = { $el: wrapper.element }
        HTMLElement.prototype.scrollIntoView = scrollIntoView
        await wrapper.setProps({ modelValue: 'b' })
        await flushPromises()
        expect(scrollIntoView).toHaveBeenCalledWith({
            block: 'nearest',
            inline: 'nearest',
        })
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(
            wrapper.findAll('[role="tab"]')[1]!.element,
        )
    })
})

describe('LayoutTabs stacked', () => {
    const UTabs = {
        props: ['items'],
        template: `<div><button v-for="item in items" :key="item.value" role="tab">
            <slot name="leading" :item="item" />
            <span><slot :item="item">{{ item.label }}</slot></span>
            <slot name="trailing" :item="item"><span data-testid="fallback-badge" /></slot>
        </button></div>`,
    }
    const UIcon = {
        props: ['name'],
        template: '<span class="icon" :data-name="name" />',
    }

    function mountStacked(badge?: unknown) {
        vi.stubGlobal('useTemplateRef', () => ref())
        return mount(Tabs, {
            props: {
                stacked: true,
                modelValue: 'projects',
                items: [
                    {
                        label: 'Projects',
                        value: 'projects',
                        icon: 'i-lucide-target',
                        badge,
                    },
                ],
            },
            global: { stubs: { UTabs, UIcon } },
        })
    }

    function accessibleName(element: Element) {
        const clone = element.cloneNode(true) as Element
        clone
            .querySelectorAll('[aria-hidden="true"]')
            .forEach((node) => node.remove())
        return clone
            .textContent!.replace(/\s+/g, ' ')
            .replace(/ ,/g, ',')
            .trim()
    }

    it('shows the icon with the count on its corner', () => {
        const wrapper = mountStacked({ label: 3, 'data-testid': 'count' })
        const iconBox = wrapper.find('[data-tab-icon]')
        expect(iconBox.find('.icon').attributes()).toMatchObject({
            'data-name': 'i-lucide-target',
            'aria-hidden': 'true',
        })
        expect(iconBox.find('[data-testid="count"]').text()).toBe('3')
        expect(wrapper.findAll('[data-testid="count"]')).toHaveLength(1)
        expect(wrapper.find('[data-testid="fallback-badge"]').exists()).toBe(
            false,
        )
        expect(accessibleName(wrapper.get('[role="tab"]').element)).toBe(
            'Projects, 3',
        )
    })

    it.each([undefined, 0, '0'])('shows no badge for %s', (badge) => {
        const wrapper = mountStacked(badge)
        expect(wrapper.find('[data-tab-icon] .icon').exists()).toBe(true)
        expect(
            wrapper
                .find('[data-tab-icon] [aria-hidden="true"]:not(.icon)')
                .exists(),
        ).toBe(false)
        expect(accessibleName(wrapper.get('[role="tab"]').element)).toBe(
            'Projects',
        )
    })
})
