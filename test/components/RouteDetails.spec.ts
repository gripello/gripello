import { mount } from '@vue/test-utils'
import RouteDetails from '~/components/RouteDetails.vue'

function createWrapper() {
    return mount(RouteDetails, {
        props: { route_id: 'r1' },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UButton: {
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
                },
                RouteReviewsDialog: {
                    props: ['modelValue', 'routeId'],
                    template:
                        '<div data-dialog :data-open="modelValue" :data-route="routeId" />',
                },
            },
        },
    })
}

describe('RouteDetails', () => {
    it('mounts the reviews dialog only once it is opened', async () => {
        const wrapper = createWrapper()
        expect(wrapper.find('[data-dialog]').exists()).toBe(false)

        await wrapper.get('[data-testid="route-details-open"]').trigger('click')

        const dialog = wrapper.get('[data-dialog]')
        expect(dialog.attributes('data-open')).toBe('true')
        expect(dialog.attributes('data-route')).toBe('r1')
    })
})
