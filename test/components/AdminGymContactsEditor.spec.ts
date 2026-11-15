import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import GymContactsEditor from '~/components/admin/GymContactsEditor.vue'
import { GYM_MAX_CONTACTS } from '#shared/utils/gymContacts'
import { emptyContact, type GymContactDraft } from '~/utils/gymSettingsDraft'
import { dialogShellStub } from '../__stubs__/dialogShell'

beforeEach(() => {
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
})

function mountEditor(
    contacts: GymContactDraft[] = [],
    general = { email: 'info@gym.test', phone: '' },
) {
    const model = reactive(contacts)
    const wrapper = mount(GymContactsEditor, {
        props: {
            modelValue: model,
            email: general.email,
            phone: general.phone,
            'onUpdate:email': (value: string) =>
                wrapper.setProps({ email: value }),
            'onUpdate:phone': (value: string) =>
                wrapper.setProps({ phone: value }),
        },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                LayoutListRow: {
                    template: '<li v-bind="$attrs"><slot /></li>',
                },
                LayoutDialogShell: dialogShellStub,
                UIcon: true,
                AdminGymContactUses: {
                    props: ['uses', 'testId'],
                    template: `<span :data-testid="testId">{{ uses.map((u) => (u.fallback ? '~' : '') + u.key).join(',') }}</span>`,
                },
                UFormField: { template: '<div><slot /></div>' },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input v-bind="$attrs" :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                OptionGrid: {
                    props: ['modelValue', 'items', 'testIdPrefix'],
                    emits: ['update:modelValue'],
                    template: `<div><button v-for="item in items" :key="item.value"
                        :data-testid="testIdPrefix + '-' + item.value"
                        @click="$emit('update:modelValue', item.value)">{{ item.label }}</button></div>`,
                },
                UButton: {
                    props: ['label'],
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')">{{ label }}</button>',
                },
            },
        },
    })
    const get = (id: string) => wrapper.get(`[data-testid="${id}"]`)
    const has = (id: string) => wrapper.find(`[data-testid="${id}"]`).exists()
    return { wrapper, model, get, has }
}

describe('AdminGymContactsEditor', () => {
    it('adds a contact through the dialog once it has a way to reach it', async () => {
        const { model, get, has } = mountEditor()
        await get('settings-contact-add').trigger('click')
        expect(
            get('contact-dialog-submit').attributes('disabled'),
        ).toBeDefined()

        await get('contact-dialog-kind-privacy').trigger('click')
        expect(has('contact-dialog-label')).toBe(false)
        await get('contact-dialog-email').setValue('dpo@')
        expect(
            get('contact-dialog-submit').attributes('disabled'),
        ).toBeDefined()
        await get('contact-dialog-email').setValue('dpo@gym.test')
        await get('contact-dialog-submit').trigger('click')

        expect(model).toEqual([
            { ...emptyContact(), kind: 'privacy', email: 'dpo@gym.test' },
        ])
        expect(get('settings-contact-0').text()).toContain('dpo@gym.test')
    })

    it('edits a row and asks for a title only for other contacts', async () => {
        const { model, get, has } = mountEditor([
            { ...emptyContact(), phone: '0123' },
        ])
        await get('settings-contact-0-edit').trigger('click')
        expect(has('contact-dialog-label')).toBe(false)
        await get('contact-dialog-kind-other').trigger('click')
        await get('contact-dialog-label').setValue('Youth team')
        await get('contact-dialog-submit').trigger('click')

        expect(model).toEqual([
            {
                ...emptyContact(),
                kind: 'other',
                label: 'Youth team',
                phone: '0123',
            },
        ])
        expect(get('settings-contact-0').text()).toContain('Youth team')
    })

    it('hides the add button at the limit and removes rows in the dialog', async () => {
        const { model, get, has } = mountEditor(
            Array.from({ length: GYM_MAX_CONTACTS }, (_, i) => ({
                ...emptyContact(),
                phone: String(i),
            })),
        )
        expect(has('settings-contact-add')).toBe(false)
        await get('settings-contact-0-edit').trigger('click')
        await get('contact-dialog-remove').trigger('click')
        expect(model).toHaveLength(GYM_MAX_CONTACTS - 1)
        expect(model[0]!.phone).toBe('1')
        expect(has('settings-contact-add')).toBe(true)
    })

    it('edits the general contact without kind, name or delete', async () => {
        const { wrapper, get, has } = mountEditor()
        await get('settings-contact-general-edit').trigger('click')
        expect(has('contact-dialog-kind-privacy')).toBe(false)
        expect(has('contact-dialog-name')).toBe(false)
        expect(has('contact-dialog-remove')).toBe(false)
        await get('contact-dialog-phone').setValue('0123')
        await get('contact-dialog-submit').trigger('click')
        expect(wrapper.props('phone')).toBe('0123')
        expect(get('settings-contact-general').text()).toContain('0123')
    })

    it('moves appeals from the general contact to a privacy contact with an e-mail', async () => {
        const { get } = mountEditor([
            { ...emptyContact(), kind: 'privacy', phone: '1' },
        ])
        expect(get('settings-contact-general-uses').text()).toBe(
            'info,imprint,privacy,replyTo,~appeals',
        )
        expect(get('settings-contact-0-uses').text()).toBe('info,privacy')

        await get('settings-contact-0-edit').trigger('click')
        await get('contact-dialog-email').setValue('dpo@gym.test')
        expect(get('contact-dialog-uses').text()).toBe('info,privacy,appeals')
        await get('contact-dialog-submit').trigger('click')
        expect(get('settings-contact-general-uses').text()).toBe(
            'info,imprint,privacy,replyTo',
        )
    })
})
