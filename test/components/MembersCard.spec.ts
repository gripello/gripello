import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref, useTemplateRef } from 'vue'
import MembersCard from '~/components/admin/MembersCard.vue'
import {
    changeMembershipRole,
    deleteMembership,
    inviteMember,
    listMembers,
} from '~/api/members'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { useList } from '~/composables/useList'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/members', () => ({
    listMembers: vi.fn(),
    inviteMember: vi.fn(),
    changeMembershipRole: vi.fn(),
    deleteMembership: vi.fn(),
}))

const ROLES = [
    {
        id: 'admin',
        name: 'admin',
        permissions: ['manage_users', 'manage_routes', 'manage_tasks'],
    },
    {
        id: 'manager',
        name: 'manager',
        permissions: ['manage_users', 'manage_routes'],
    },
    { id: 'setter', name: 'routesetter', permissions: ['manage_routes'] },
    { id: 'helper', name: 'helper', permissions: ['manage_tasks'] },
]

const member = (id: string, user: string, role: string) => ({
    id,
    user: { id: user, firstname: user, name: 'X', email: `${user}@x.test` },
    role: { id: role },
})

const notifyError = vi.fn()
const notifySuccess = vi.fn()
const refreshInvites = vi.fn(async () => {})

beforeEach(() => {
    notifyError.mockReset()
    notifySuccess.mockReset()
    refreshInvites.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(listMembers)
        .mockReset()
        .mockResolvedValue({
            items: [
                member('m-me', 'me', 'manager'),
                member('m-boss', 'boss', 'admin'),
                member('m-ann', 'ann', 'setter'),
            ],
            total: 3,
        } as never)
    vi.mocked(inviteMember)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.mocked(changeMembershipRole)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.mocked(deleteMembership)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('useTemplateRef', useTemplateRef)
    vi.stubGlobal('useDisplay', () => ({ mdAndUp: ref(false) }))
    vi.stubGlobal('useRoute', () => ({ query: {} }))
    vi.stubGlobal('useAuthStore', () => ({ record: { id: 'me' } }))
    vi.stubGlobal('useRoles', () => ({
        data: ref(ROLES),
        refresh: vi.fn(),
    }))
    vi.stubGlobal('usePermissions', () => ({
        memberships: ref([{ gym: { id: 'g1' }, role: ROLES[1] }]),
        isPlatformAdmin: ref(false),
    }))
    vi.stubGlobal('useList', useList)
    vi.stubGlobal('useAsyncAction', useAsyncAction)
    vi.stubGlobal('useNotification', () => ({
        success: notifySuccess,
        error: notifyError,
    }))
    vi.stubGlobal('useLiveRefresh', vi.fn())
})

async function mountCard() {
    const wrapper = mount(MembersCard, {
        props: { gymId: 'g1' },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: dialogShellStub,
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                UFormField: { template: '<div><slot /></div>' },
                FilterBar: true,
                AdminMemberIdentity: {
                    props: ['member'],
                    template: '<span>{{ member.user }}</span>',
                },
                AdminPendingInvites: {
                    setup: (_props, { expose }) =>
                        expose({ refresh: refreshInvites }),
                    template: '<div />',
                },
                UButton: {
                    props: ['disabled'],
                    emits: ['click'],
                    template:
                        '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
                },
                UDropdownMenu: {
                    props: ['items', 'disabled'],
                    template: `<div><slot />
                        <button v-for="item in items" :key="item.label" :disabled="disabled"
                            :data-testid="item['data-testid']" @click="item.onSelect()" /></div>`,
                },
                USelect: {
                    props: ['modelValue', 'items', 'disabled'],
                    emits: ['update:modelValue'],
                    template: `<select :value="modelValue" :disabled="disabled"
                        @change="$emit('update:modelValue', $event.target.value)">
                        <option v-for="item in items" :key="item.value" :value="item.value"
                            :disabled="item.disabled">{{ item.label }}</option>
                    </select>`,
                },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                UForm: {
                    props: ['state', 'validate'],
                    emits: ['submit'],
                    setup(props, { emit, expose }) {
                        const errors = ref<{ name: string }[]>([])
                        expose({
                            submit() {
                                errors.value = props.validate(props.state)
                                if (!errors.value.length) emit('submit')
                            },
                        })
                        return { errors }
                    },
                    template: `<form><slot />
                        <p v-for="error in errors" :key="error.name" data-testid="form-error">{{ error.name }}</p></form>`,
                },
                ConfirmDialog: {
                    props: ['modelValue'],
                    emits: ['confirm'],
                    template: `<div v-if="modelValue" data-testid="confirm-dialog">
                        <button data-testid="confirm-dialog-confirm" @click="$emit('confirm')" /></div>`,
                },
            },
        },
    })
    await flushPromises()
    const rows = () => wrapper.get('[data-testid="members-list"]').findAll('li')
    const row = (name: string) => rows().find((li) => li.text().includes(name))!
    return { wrapper, row }
}

async function openInvite(
    wrapper: Awaited<ReturnType<typeof mountCard>>['wrapper'],
) {
    ;(wrapper.vm as unknown as { openInvite: () => void }).openInvite()
    await flushPromises()
    const dialog = wrapper.get('[data-testid="member-invite-dialog"]')
    const field = (id: string) => dialog.get(`[data-testid="${id}"]`)
    return { dialog, field }
}

describe('MembersCard', () => {
    it('only lets managers change members whose role they could grant, never themselves', async () => {
        const { row } = await mountCard()
        const select = (name: string) =>
            row(name).get('[data-testid="member-card-role"]')
        expect(select('me').attributes('disabled')).toBeDefined()
        expect(select('boss').attributes('disabled')).toBeDefined()
        expect(
            row('boss')
                .get('[data-testid="member-card-remove"]')
                .attributes('disabled'),
        ).toBeDefined()
        expect(select('ann').attributes('disabled')).toBeUndefined()

        const options = select('ann').findAll('option')
        expect(
            options.map((option) => [
                option.attributes('value'),
                option.attributes('disabled') !== undefined,
            ]),
        ).toEqual([
            ['admin', true],
            ['manager', false],
            ['setter', false],
            ['helper', true],
        ])
    })

    it('changes a role once and reloads the members', async () => {
        const { row } = await mountCard()
        const select = row('ann').get('[data-testid="member-card-role"]')
        await select.setValue('setter')
        expect(changeMembershipRole).not.toHaveBeenCalled()

        await select.setValue('manager')
        await flushPromises()
        expect(changeMembershipRole).toHaveBeenCalledExactlyOnceWith(
            'm-ann',
            'manager',
        )
        expect(listMembers).toHaveBeenCalledTimes(2)
    })

    it('invites with a grantable role and refreshes the pending invites', async () => {
        const { wrapper } = await mountCard()
        const { dialog, field } = await openInvite(wrapper)
        const role = field('member-invite-role')
        expect((role.element as HTMLSelectElement).value).toBe('manager')
        expect(
            role.findAll('option').map((option) => option.attributes('value')),
        ).toEqual(['manager', 'setter'])

        await field('member-invite-email').setValue('not-an-email')
        await dialog
            .get('[data-testid="member-invite-submit"]')
            .trigger('click')
        expect(dialog.get('[data-testid="form-error"]').text()).toBe('email')
        expect(inviteMember).not.toHaveBeenCalled()

        await field('member-invite-email').setValue(' new@x.test ')
        await field('member-invite-firstname').setValue(' New ')
        await role.setValue('setter')
        await dialog
            .get('[data-testid="member-invite-submit"]')
            .trigger('click')
        await flushPromises()
        expect(inviteMember).toHaveBeenCalledWith('g1', {
            email: 'new@x.test',
            role: 'setter',
            firstname: 'New',
            name: '',
        })
        expect(notifySuccess).toHaveBeenCalledWith('members.invited')
        expect(refreshInvites).toHaveBeenCalledOnce()
    })

    it.each([
        [{ status: 409 }, 'members.alreadyMember'],
        [
            {
                status: 400,
                response: {
                    data: { email: { code: 'validation_email_blocked' } },
                },
            },
            'errors.emailBlocked',
        ],
        [{ status: 500 }, 'notifications.error.generic'],
    ])('keeps the invite open and explains a refusal', async (error, key) => {
        vi.mocked(inviteMember).mockRejectedValue(error)
        const { wrapper } = await mountCard()
        const { dialog, field } = await openInvite(wrapper)
        await field('member-invite-email').setValue('new@x.test')
        await dialog
            .get('[data-testid="member-invite-submit"]')
            .trigger('click')
        await flushPromises()
        expect(notifyError).toHaveBeenCalledWith(key)
        expect(notifySuccess).not.toHaveBeenCalled()
        expect(refreshInvites).not.toHaveBeenCalled()
        expect(
            (
                wrapper.get('[data-testid="member-invite-email"]')
                    .element as HTMLInputElement
            ).value,
        ).toBe('new@x.test')
    })

    it('removes a member only after the confirm', async () => {
        const { wrapper, row } = await mountCard()
        await row('ann')
            .get('[data-testid="member-card-remove"]')
            .trigger('click')
        expect(deleteMembership).not.toHaveBeenCalled()
        await wrapper
            .get('[data-testid="confirm-dialog-confirm"]')
            .trigger('click')
        await flushPromises()
        expect(deleteMembership).toHaveBeenCalledWith('m-ann')
        expect(wrapper.text()).not.toContain('ann')
        expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(
            false,
        )
    })

    it('keeps the member when removing fails', async () => {
        vi.mocked(deleteMembership).mockRejectedValue({ status: 409 })
        const { wrapper, row } = await mountCard()
        await row('ann')
            .get('[data-testid="member-card-remove"]')
            .trigger('click')
        await wrapper
            .get('[data-testid="confirm-dialog-confirm"]')
            .trigger('click')
        await flushPromises()
        expect(notifyError).toHaveBeenCalledWith('notifications.error.generic')
        expect(wrapper.text()).toContain('ann')
        expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(
            true,
        )
    })
})
