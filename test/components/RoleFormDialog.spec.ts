import { flushPromises, mount } from '@vue/test-utils'
import { computed, reactive, ref, watch } from 'vue'
import RoleFormDialog from '~/components/admin/RoleFormDialog.vue'
import { createRole } from '~/api/members'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/members', () => ({ createRole: vi.fn(), updateRole: vi.fn() }))

function mountDialog() {
    return mount(RoleFormDialog, {
        props: { role: { name: 'Setter' } },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: dialogShellStub,
                UForm: {
                    setup(
                        _: unknown,
                        { expose }: { expose: (api: object) => void },
                    ) {
                        expose({ validate: async () => true })
                    },
                    template: '<form><slot /></form>',
                },
                UFormField: {
                    props: ['error'],
                    template:
                        '<div><span data-testid="field-error">{{ error }}</span><slot /></div>',
                },
                UInput: true,
                UBadge: true,
                ColorSwatchPicker: true,
            },
        },
    })
}

function rejectName(code: string) {
    vi.mocked(createRole).mockRejectedValueOnce({
        status: 400,
        response: { data: { name: { code, message: '' } } },
    })
}

describe('RoleFormDialog', () => {
    beforeEach(() => {
        vi.mocked(createRole).mockReset()
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('useCurrentGymId', () => ref('g1'))
        vi.stubGlobal('useNotification', () => ({ error: vi.fn() }))
    })

    it('calls only a duplicate name taken', async () => {
        const wrapper = mountDialog()
        const submit = wrapper.get('[data-testid="role-form-submit"]')
        const nameError = () =>
            wrapper.findAll('[data-testid="field-error"]')[0]!.text()

        rejectName('validation_not_unique')
        await submit.trigger('click')
        await flushPromises()
        expect(nameError()).toBe('permissions.nameTaken')

        rejectName('validation_name_protected')
        await submit.trigger('click')
        await flushPromises()
        expect(nameError()).toBe('errors.nameProtected')
    })

    it('creates once when submitted twice', async () => {
        let finish!: (value: unknown) => void
        vi.mocked(createRole).mockImplementationOnce(
            () => new Promise((resolve) => (finish = resolve)),
        )
        const wrapper = mountDialog()
        const submit = wrapper.get('[data-testid="role-form-submit"]')

        await submit.trigger('click')
        await submit.trigger('click')
        finish({ id: 'r1' })
        await flushPromises()

        expect(createRole).toHaveBeenCalledTimes(1)
        expect(wrapper.emitted('saved')).toEqual([['created', 'r1']])
    })
})
