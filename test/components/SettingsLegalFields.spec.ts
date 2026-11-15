import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LegalFields from '~/components/settings/LegalFields.vue'
import { legalFieldsFrom } from '~/utils/legalFields'

function mountFields(contact?: { email: string; phone: string }) {
    return mount(LegalFields, {
        props: { legal: legalFieldsFrom({}), contact },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UFormField: { template: '<div><slot /></div>' },
                UInput: { template: '<input v-bind="$attrs" />' },
                UTextarea: { template: '<textarea v-bind="$attrs" />' },
                UButton: {
                    template: '<button v-bind="$attrs"><slot /></button>',
                },
                UIcon: true,
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                LayoutListRow: { template: '<li><slot /></li>' },
            },
        },
    })
}

describe('SettingsLegalFields', () => {
    it('edits the phone where no general contact is given', () => {
        const wrapper = mountFields()
        expect(
            wrapper.find('[data-testid="settings-legal-phone"]').exists(),
        ).toBe(true)
        expect(
            wrapper.find('[data-testid="settings-legal-contact"]').exists(),
        ).toBe(false)
    })

    it('shows the general contact instead and opens it on click', async () => {
        const wrapper = mountFields({ email: 'info@gym.test', phone: '0123' })
        expect(
            wrapper.find('[data-testid="settings-legal-phone"]').exists(),
        ).toBe(false)
        const row = wrapper.get('[data-testid="settings-legal-contact"]')
        expect(row.text()).toContain('info@gym.test')
        expect(row.text()).toContain('0123')
        await row.trigger('click')
        expect(wrapper.emitted('editContact')).toHaveLength(1)
    })
})
