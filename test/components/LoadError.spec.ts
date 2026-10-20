import { mount } from '@vue/test-utils'
import LoadError from '~/components/layout/LoadError.vue'

const buttonStub = {
    emits: ['click'],
    template:
        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
}

function createWrapper(props: Record<string, unknown> = {}) {
    return mount(LoadError, {
        props,
        global: {
            stubs: { UIcon: true, UButton: buttonStub },
            mocks: { $t: (key: string) => key },
        },
    })
}

describe('LoadError', () => {
    it('renders an alert with the shared load-error test ids', () => {
        const wrapper = createWrapper()

        const alert = wrapper.get('[data-testid="load-error"]')
        expect(alert.attributes('role')).toBe('alert')
        expect(alert.text()).toContain('errors.loadFailed')
        expect(alert.classes()).toContain('border')
        expect(wrapper.get('[data-testid="load-error-retry"]').text()).toBe(
            'errors.retry',
        )
    })

    it('emits retry when the retry button is pressed', async () => {
        const wrapper = createWrapper()

        await wrapper.get('[data-testid="load-error-retry"]').trigger('click')

        expect(wrapper.emitted('retry')).toHaveLength(1)
    })

    it('drops the card frame when asked to', () => {
        const wrapper = createWrapper({ card: false })

        expect(
            wrapper.get('[data-testid="load-error"]').classes(),
        ).not.toContain('border')
    })
})
