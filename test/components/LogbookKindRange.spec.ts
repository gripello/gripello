import { mount } from '@vue/test-utils'
import KindRange from '~/components/logbook/KindRange.vue'

const SegmentedControl = {
    props: ['modelValue', 'items', 'testId'],
    emits: ['update:modelValue'],
    template:
        '<div :data-testid="testId"><button v-for="item in items" :key="item.value" @click="$emit(\'update:modelValue\', item.value)">{{ item.value }}</button></div>',
}

describe('LogbookKindRange', () => {
    it('offers both kinds and ranges under the given test id prefix', async () => {
        const wrapper = mount(KindRange, {
            props: {
                testIdPrefix: 'climber',
                kind: 'boulder',
                range: '12m',
                'onUpdate:kind': (value: string) =>
                    wrapper.setProps({ kind: value as 'route' }),
            },
            global: { stubs: { SegmentedControl } },
        })

        const kinds = wrapper.find('[data-testid="climber-kind"]')
        expect(kinds.findAll('button').map((b) => b.text())).toEqual([
            'boulder',
            'route',
        ])
        expect(
            wrapper
                .find('[data-testid="climber-range"]')
                .findAll('button')
                .map((b) => b.text()),
        ).toEqual(['30d', '12m', 'all'])

        await kinds.findAll('button')[1]!.trigger('click')
        expect(wrapper.props('kind')).toBe('route')
    })
})
