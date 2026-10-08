import { mount } from '@vue/test-utils'
import AttemptStepper from '~/components/competition/AttemptStepper.vue'

function createWrapper(props: Record<string, unknown> = {}) {
    return mount(AttemptStepper, {
        props: {
            attempts: 2,
            testIdPrefix: 'judge',
            testIdSuffix: 7,
            ...props,
        },
        global: {
            mocks: {
                $t: (key: string, params?: { n: number }) =>
                    `${key}:${params?.n ?? ''}`,
            },
            stubs: {
                UButton: {
                    props: ['disabled', 'size'],
                    template:
                        '<button :disabled="disabled" :data-size="size" />',
                },
            },
        },
    })
}

describe('CompetitionAttemptStepper', () => {
    it('shows the count and emits undo and add', async () => {
        const wrapper = createWrapper()

        expect(wrapper.find('[data-testid="judge-attempts-7"]').text()).toBe(
            'competitions.scorecard.attempts:2',
        )
        await wrapper.find('[data-testid="judge-undo-7"]').trigger('click')
        await wrapper.find('[data-testid="judge-attempt-7"]').trigger('click')
        expect(wrapper.emitted('undo')).toHaveLength(1)
        expect(wrapper.emitted('add')).toHaveLength(1)
    })

    it('disables adding once topped', () => {
        const wrapper = createWrapper({ addDisabled: true })

        expect(
            wrapper.find('[data-testid="judge-attempt-7"]').attributes(),
        ).toHaveProperty('disabled')
        expect(
            wrapper.find('[data-testid="judge-undo-7"]').attributes(),
        ).not.toHaveProperty('disabled')
    })
})
