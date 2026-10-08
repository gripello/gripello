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
