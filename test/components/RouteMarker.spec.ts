import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MapRouteMarker from '~/components/map/RouteMarker.vue'

const base = {
    at: [10, 20] as [number, number],
    fill: '#E53935',
    stroke: '#FFFFFF',
    grade: '6A',
    pixelsPerUnit: 10,
    hitRadiusPx: 13,
}

function createWrapper(props: Record<string, unknown> = {}) {
    return mount(MapRouteMarker, { props: { ...base, ...props } })
}

describe('MapRouteMarker', () => {
    it('draws a grade circle with the grade in its contrast colour', () => {
        const wrapper = createWrapper({ asGrade: true })
        const body = wrapper.get('.map-dot-body')
        expect(body.attributes('r')).toBe('1.4')
        expect(body.attributes('fill')).toBe('#E53935')
        const grade = wrapper.get('[data-testid="map-dot-grade"]')
        expect(grade.text()).toBe('6A')
        expect(grade.attributes('fill')).toBe('#FFFFFF')
        expect(grade.attributes('font-size')).toBe('1.1')
    })

    it('draws a small dot without the grade', () => {
        const wrapper = createWrapper()
        expect(wrapper.get('.map-dot-body').attributes('r')).toBe('0.55')
        expect(wrapper.find('[data-testid="map-dot-grade"]').exists()).toBe(
            false,
        )
    })

    it('names the status badges of a grade circle', () => {
        const wrapper = createWrapper({
            asGrade: true,
            sent: true,
            defect: 'minor',
            isNew: true,
        })
        expect(
            wrapper.findAll('.map-dot-badge title').map((t) => t.text()),
        ).toEqual([
            'ticks.sent',
            'tasks.defect.marker',
            'ticks.suggestions.new',
        ])
        expect(wrapper.find('.map-dot-badge--defect-minor').exists()).toBe(true)
    })

    it('marks a dot as sent, defective and new without badges', () => {
        const wrapper = createWrapper({
            sent: true,
            defect: 'urgent',
            isNew: true,
        })
        expect(wrapper.find('.map-dot-badge').exists()).toBe(false)
        expect(wrapper.find('.map-dot-check').exists()).toBe(true)
        expect(wrapper.find('.map-dot-halo').exists()).toBe(true)
        expect(
            wrapper.get('[data-testid="map-dot-defect"]').classes(),
        ).toContain('map-dot-defect--urgent')
    })

    it('rings the selected marker', () => {
        expect(createWrapper().find('.map-dot-ring').exists()).toBe(false)
        expect(
            createWrapper({ selected: true }).find('.map-dot-ring').exists(),
        ).toBe(true)
    })

    it('passes interaction attributes to its root group', async () => {
        const clicks: string[] = []
        const wrapper = mount(MapRouteMarker, {
            props: base,
            attrs: {
                'data-testid': 'map-route-dot',
                onClick: () => clicks.push('click'),
            },
        })
        expect(wrapper.element.tagName.toLowerCase()).toBe('g')
        expect(wrapper.attributes('data-testid')).toBe('map-route-dot')
        await wrapper.trigger('click')
        expect(clicks).toEqual(['click'])
    })
})
