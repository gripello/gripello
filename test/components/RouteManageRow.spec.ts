import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import RouteManageRow from '~/components/route/ManageRow.vue'

beforeEach(() => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
})

function mountRow(route: Record<string, unknown>, selected = false) {
    return mount(RouteManageRow, {
        props: {
            route: { id: 'r1', name: 'Crimp', color: '#f00', ...route },
            selected,
        } as never,
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UCheckbox: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input type="checkbox" v-bind="$attrs" :checked="modelValue"
                        @change="$emit('update:modelValue', $event.target.checked)" />`,
                },
                UBadge: {
                    template: '<span data-testid="archived"><slot /></span>',
                },
                RouteRatedMarker: { template: '<i data-testid="rated" />' },
                RouteColorDot: true,
                TaskDefectMarker: true,
                GradeLabel: true,
            },
        },
    })
}

const meta = (wrapper: ReturnType<typeof mountRow>) =>
    wrapper.get('.manage-row__meta').text()

describe('RouteManageRow', () => {
    it('lists anchor, wall and setters, skipping what is unknown', () => {
        expect(
            meta(
                mountRow({
                    anchor_point: 7,
                    expand: { wall: { name: 'Cave' } },
                    creator: ['Ana', 'Ben'],
                }),
            ),
        ).toBe('climbing.anchor_point 7 · Cave · Ana, Ben')
        expect(meta(mountRow({ anchor_point: 0, creator: [] }))).toBe('')
        expect(meta(mountRow({ anchor_point: null }))).toBe('')
    })

    it('marks archived and reviewed routes', () => {
        const plain = mountRow({})
        expect(plain.find('[data-testid="archived"]').exists()).toBe(false)
        expect(plain.find('[data-testid="rated"]').exists()).toBe(false)
        const marked = mountRow({ archived: true, has_ratings: true })
        expect(marked.get('[data-testid="archived"]').text()).toBe(
            'filter.archived',
        )
        expect(marked.find('[data-testid="rated"]').exists()).toBe(true)
    })

    it('selects with the checkbox and opens with the row', async () => {
        const wrapper = mountRow({}, true)
        expect(wrapper.get('[data-testid="routes-row"]').classes()).toContain(
            'manage-row--selected',
        )
        await wrapper.get('[data-testid="routes-row-select"]').setValue(false)
        expect(wrapper.emitted('update:selected')).toEqual([[false]])
        expect(wrapper.emitted('edit')).toBeUndefined()

        await wrapper.get('[data-testid="routes-row-open"]').trigger('click')
        expect(wrapper.emitted('edit')).toHaveLength(1)
    })
})
