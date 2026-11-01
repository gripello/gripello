import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import RolePermissionsEditor from '~/components/admin/RolePermissionsEditor.vue'
import { listPermissions } from '~/api/gyms'
import { deleteRole, listRoles, setRolePermissions } from '~/api/members'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/gyms', () => ({ listPermissions: vi.fn() }))
vi.mock('~/api/members', () => ({
    listRoles: vi.fn(),
    setRolePermissions: vi.fn(),
    deleteRole: vi.fn(),
}))

const notifyError = vi.fn()
const query = ref<Record<string, string>>({})
let ownRole = 'setter'
let platformAdmin = false

const roles = () => [
    {
        id: 'admin',
        name: 'admin',
        members: 1,
        permissions: ['manage_users', 'manage_settings', 'manage_routes'],
    },
    {
        id: 'setter',
        name: 'routesetter',
        members: 2,
        permissions: ['manage_users', 'manage_routes'],
    },
    { id: 'guest', name: 'guest', members: 0, permissions: [] },
]

beforeEach(() => {
    ownRole = 'setter'
    platformAdmin = false
    query.value = {}
    notifyError.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(listRoles)
        .mockReset()
        .mockImplementation(async () => roles() as never)
    vi.mocked(listPermissions)
        .mockReset()
        .mockResolvedValue([
            { id: 'p1', name: 'manage_users' },
            { id: 'p2', name: 'manage_settings' },
            { id: 'p3', name: 'manage_routes' },
        ] as never)
    vi.mocked(setRolePermissions)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.mocked(deleteRole)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.stubGlobal('useCurrentGymId', () => ref('g1'))
    vi.stubGlobal('usePermissions', () => ({
        memberships: ref([{ gym: { id: 'g1' }, role: { id: ownRole } }]),
        isPlatformAdmin: ref(platformAdmin),
    }))
    vi.stubGlobal('useAsyncAction', useAsyncAction)
    vi.stubGlobal('useNotification', () => ({
        success: vi.fn(),
        error: notifyError,
        notify: vi.fn(),
    }))
    vi.stubGlobal('useRoute', () => ({
        get query() {
            return query.value
        },
        hash: '',
    }))
    vi.stubGlobal('useRouter', () => ({
        push: async ({ query: next }: { query: Record<string, string> }) => {
            query.value = next
        },
    }))
    vi.stubGlobal('useLiveRefresh', vi.fn())
    vi.stubGlobal(
        'refreshNuxtData',
        vi.fn(async () => {}),
    )
})

async function mountEditor() {
    const wrapper = mount(RolePermissionsEditor, {
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: dialogShellStub,
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                LayoutPanel: {
                    template: '<div><slot name="actions" /><slot /></div>',
                },
                UTooltip: { template: '<div><slot /></div>' },
                UFormField: { template: '<div><slot /></div>' },
                UButton: {
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
                },
                USwitch: {
                    props: ['modelValue', 'disabled'],
                    emits: ['update:modelValue'],
                    template: `<button :aria-checked="String(modelValue)" :disabled="disabled"
                        @click="$emit('update:modelValue', !modelValue)" />`,
                },
                UCheckbox: {
                    props: ['modelValue', 'disabled'],
                    emits: ['update:modelValue'],
                    template: `<button :disabled="disabled"
                        @click="$emit('update:modelValue', true)" />`,
                },
                USelect: {
                    props: ['modelValue', 'items'],
                    emits: ['update:modelValue'],
                    template: `<select :value="modelValue"
                        @change="$emit('update:modelValue', $event.target.value)">
                        <option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select>`,
                },
                ConfirmDialog: {
                    props: ['modelValue', 'title'],
                    emits: ['confirm'],
                    template: `<div v-if="modelValue" data-testid="confirm-dialog">{{ title }}
                        <button data-testid="confirm-dialog-confirm" @click="$emit('confirm')" /></div>`,
                },
                AdminRoleFormDialog: true,
                AdminRoleBadge: true,
            },
        },
    })
    await flushPromises()
    return wrapper
}

const toggle = (role: string, perm: string) =>
    `[data-testid="role-permissions-${role}-${perm}"]`

describe('RolePermissionsEditor', () => {
    it('locks the admin role: no switch changes and no delete', async () => {
        const wrapper = await mountEditor()
        expect(wrapper.get('[data-testid="role-detail"]').text()).toContain(
            'admin',
        )
        expect(
            wrapper
                .get(toggle('admin', 'manage_routes'))
                .attributes('disabled'),
        ).toBeDefined()
        expect(wrapper.find('[data-testid="role-delete-admin"]').exists()).toBe(
            false,
        )

        await wrapper
            .get('[data-testid="role-permissions-row-routesetter"]')
            .trigger('click')
        expect(
            wrapper
                .get(toggle('routesetter', 'manage_routes'))
                .attributes('disabled'),
        ).toBeUndefined()
        expect(
            wrapper.find('[data-testid="role-delete-routesetter"]').exists(),
        ).toBe(true)
    })

    it('saves a toggled permission and reverts it when the save fails', async () => {
        query.value = { role: 'guest' }
        const wrapper = await mountEditor()
        await wrapper.get(toggle('guest', 'manage_routes')).trigger('click')
        await flushPromises()
        expect(setRolePermissions).toHaveBeenCalledWith('guest', [
            'manage_routes',
        ])
        expect(
            wrapper
                .get(toggle('guest', 'manage_routes'))
                .attributes('aria-checked'),
        ).toBe('true')

        vi.mocked(setRolePermissions).mockRejectedValueOnce(new Error('down'))
        await wrapper.get(toggle('guest', 'manage_users')).trigger('click')
        await flushPromises()
        expect(notifyError).toHaveBeenCalledWith('permissions.updateError')
        expect(
            wrapper
                .get(toggle('guest', 'manage_users'))
                .attributes('aria-checked'),
        ).toBe('false')
        expect(wrapper.get('[data-testid="role-granted-guest"]').text()).toBe(
            '1/3',
        )
    })

    it('asks before removing user management from the own role', async () => {
        query.value = { role: 'setter' }
        const wrapper = await mountEditor()
        await wrapper
            .get(toggle('routesetter', 'manage_users'))
            .trigger('click')
        expect(setRolePermissions).not.toHaveBeenCalled()
        expect(wrapper.get('[data-testid="confirm-dialog"]').text()).toContain(
            'permissions.lockoutTitle',
        )

        await wrapper
            .get('[data-testid="confirm-dialog-confirm"]')
            .trigger('click')
        await flushPromises()
        expect(setRolePermissions).toHaveBeenCalledWith('setter', [
            'manage_routes',
        ])
        expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(
            false,
        )
    })

    it('saves the own role at once for a platform admin', async () => {
        platformAdmin = true
        query.value = { role: 'setter' }
        const wrapper = await mountEditor()
        await wrapper
            .get(toggle('routesetter', 'manage_users'))
            .trigger('click')
        await flushPromises()
        expect(setRolePermissions).toHaveBeenCalledWith('setter', [
            'manage_routes',
        ])
        expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(
            false,
        )
    })

    it('moves the holders of a deleted role to the chosen role', async () => {
        query.value = { role: 'setter' }
        const wrapper = await mountEditor()
        await wrapper
            .get('[data-testid="role-delete-routesetter"]')
            .trigger('click')
        expect(
            wrapper.get('[data-testid="role-delete-holders"]').exists(),
        ).toBe(true)
        const reassign = wrapper.get('[data-testid="role-delete-reassign"]')
        expect(
            reassign.findAll('option').map((option) => option.text()),
        ).toEqual(['admin', 'guest'])
        await reassign.setValue('admin')
        await wrapper
            .get('[data-testid="role-delete-confirm"]')
            .trigger('click')
        await flushPromises()
        expect(deleteRole).toHaveBeenCalledWith('setter', 'admin')
        expect(query.value).toEqual({})
    })

    it('deletes a role nobody holds without moving anyone', async () => {
        query.value = { role: 'guest' }
        const wrapper = await mountEditor()
        await wrapper.get('[data-testid="role-delete-guest"]').trigger('click')
        expect(
            wrapper.find('[data-testid="role-delete-holders"]').exists(),
        ).toBe(false)
        await wrapper
            .get('[data-testid="role-delete-confirm"]')
            .trigger('click')
        await flushPromises()
        expect(deleteRole).toHaveBeenCalledWith('guest', undefined)
    })
})
