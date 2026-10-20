import { mount } from '@vue/test-utils'
import RouteDetails from '~/components/RouteDetails.vue'

function createWrapper(compact = false) {
    return mount(RouteDetails, {
        props: { route_id: 'r1', compact },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UButton: {
                    props: ['color', 'variant', 'icon'],
                    template:
                        '<button v-bind="$attrs" :data-color="color" :data-icon="icon" @click="$emit(\'click\')"><slot /></button>',
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

    it.each([false, true])(
        'keeps the reviews action neutral (compact: %s)',
        (compact) => {
            const button = createWrapper(compact).get(
                '[data-testid="route-details-open"]',
            )
            expect(button.attributes('data-color')).toBe('neutral')
            expect(button.attributes('data-icon')).toBe(
                'i-lucide-message-square-text',
            )
        },
    )
})
