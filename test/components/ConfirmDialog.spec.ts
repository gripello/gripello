import { mount } from '@vue/test-utils'
import ConfirmDialog from '~/components/confirm/Dialog.vue'
import { dialogShellStub } from '../__stubs__/dialogShell'

const dialogStub = {
    ...dialogShellStub,
    template: `<div>{{ title }}${dialogShellStub.template}</div>`,
}

const buttonStub = {
    props: ['loading'],
    template: '<button @click="$emit(\'click\')"><slot /></button>',
}

function createWrapper(props: Record<string, unknown> = {}) {
    return mount(ConfirmDialog, {
        props: {
            modelValue: true,
            title: 'Delete route',
            message: 'Do you really want to delete this route?',
            ...props,
        },
        global: {
            mocks: {
                $t: (key: string) => key,
            },
            stubs: {
                LayoutDialogShell: dialogStub,
                UButton: buttonStub,
            },
        },
    })
}

describe('ConfirmDialog', () => {
    it('renders the title and message', () => {
        const wrapper = createWrapper()

        expect(wrapper.text()).toContain('Delete route')
        expect(wrapper.text()).toContain(
            'Do you really want to delete this route?',
        )
    })

    it('emits confirm when the confirm button is clicked', async () => {
        const wrapper = createWrapper()
        const buttons = wrapper.findAll('button')

        // Last button is the confirm action.
        await buttons[buttons.length - 1].trigger('click')

        expect(wrapper.emitted('confirm')).toBeTruthy()
    })

    it('closes the dialog when cancel is clicked', async () => {
        const wrapper = createWrapper()
        const buttons = wrapper.findAll('button')

        // First button is the cancel action.
        await buttons[0].trigger('click')

        const updates = wrapper.emitted('update:modelValue')
        expect(updates).toBeTruthy()
        expect(updates![updates!.length - 1]).toEqual([false])
    })

    it('falls back to the default delete label when confirmText is absent', () => {
        const wrapper = createWrapper()

        expect(wrapper.text()).toContain('actions.delete')
    })

    it('uses a custom confirm label when provided', () => {
        const wrapper = createWrapper({ confirmText: 'Remove' })

        expect(wrapper.text()).toContain('Remove')
    })
})
