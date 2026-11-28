import { mount } from '@vue/test-utils'
import TaskDefectMarker from '~/components/task/DefectMarker.vue'

function marker(severity?: 'urgent' | 'minor') {
    return mount(TaskDefectMarker, {
        props: { severity },
        global: {
            stubs: {
                UIcon: { template: '<i :data-icon="name" />', props: ['name'] },
            },
        },
    }).find('[data-testid="route-defect-marker"]')
}

describe('TaskDefectMarker', () => {
    it('tells urgent and normal defects apart beyond colour', () => {
        expect(marker('urgent').attributes()).toMatchObject({
            'data-icon': 'i-lucide-octagon-alert',
            'aria-label': 'tasks.defect.urgentMarker',
            title: 'tasks.defect.urgentMarker',
        })
        expect(marker('minor').attributes()).toMatchObject({
            'data-icon': 'i-lucide-triangle-alert',
            'aria-label': 'tasks.defect.marker',
        })
        expect(marker().exists()).toBe(false)
    })
})
