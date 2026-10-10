import { test, expect } from '../../support/fixtures'
import {
    addMembership,
    changeMembershipRole,
    createRole,
    findRole,
    inviteMember,
    membershipOf,
    setRolePermissions,
    updateMe,
    type Api,
} from '../../support/api'
import type { SeededUser } from '../../support/seed'

test.describe('role escalation guard', () => {
    test('a plain member cannot give themselves the admin role', async ({
        adminApi,
        apiAs,
        createUser,
    }) => {
        const user = await createUser()
        const adminRole = await findRole(adminApi, 'admin')

        await expect(
            addMembership(await apiAs(user), user.id, adminRole.id),
        ).rejects.toMatchObject({ status: 403 })

        expect(await membershipOf(adminApi, user.id)).toBeNull()
    })

    test('a plain member can still edit their own profile', async ({
        apiAs,
        createUser,
    }) => {
        const user = await createUser()

        const updated = await updateMe(await apiAs(user), {
            firstname: 'Guarded',
        })

        expect(updated.firstname).toBe('Guarded')
    })

    test('manage_users cannot attach a user without an invite', async ({
        adminApi,
        apiAs,
        createUser,
    }) => {
        const manager = await createUser('admin', 'mgr')
        const target = await createUser('user', 'tgt')
        const setterRole = await findRole(adminApi, 'routesetter')

        await expect(
            addMembership(await apiAs(manager), target.id, setterRole.id),
        ).rejects.toMatchObject({ status: 403 })

        expect(await membershipOf(adminApi, target.id)).toBeNull()
    })
})

test.describe('user manager without admin role', () => {
    async function managerSetup({
        api,
        adminApi,
        apiAs,
        createUser,
        testPrefix: prefix,
    }: {
        api: Api
        adminApi: Api
        apiAs: (user: SeededUser) => Promise<Api>
        createUser: (role?: string, label?: string) => Promise<SeededUser>
        testPrefix: string
    }) {
        const managerRole = await createRole(adminApi, `${prefix}-mgr-role`, [
            'manage_users',
        ])
        const narrowRole = await createRole(
            adminApi,
            `${prefix}-narrow-role`,
            [],
        )
        const manager = await createUser('user', 'mgr')
        const target = await createUser('user', 'tgt')
        await addMembership(api, manager.id, managerRole.id)
        await addMembership(api, target.id, narrowRole.id)
        return {
            managerApi: await apiAs(manager),
            managerRole,
            narrowRole,
            manager,
            target,
        }
    }

    test('cannot give the admin role to anyone', async ({
        api,
        adminApi,
        apiAs,
        createUser,
        testPrefix,
    }) => {
        const setup = await managerSetup({
            api,
            adminApi,
            apiAs,
            createUser,
            testPrefix,
        })
        const adminRole = await findRole(adminApi, 'admin')
        const own = await membershipOf(adminApi, setup.manager.id)
        const target = await membershipOf(adminApi, setup.target.id)

        await expect(
            changeMembershipRole(setup.managerApi, own!.id, adminRole.id),
        ).rejects.toMatchObject({ status: 403 })
        await expect(
            changeMembershipRole(setup.managerApi, target!.id, adminRole.id),
        ).rejects.toMatchObject({ status: 403 })

        const outsider = await createUser('user', 'out')
        await expect(
            inviteMember(setup.managerApi, {
                email: outsider.email,
                role: adminRole.id,
            }),
        ).rejects.toMatchObject({ status: 403 })
        expect(await membershipOf(adminApi, outsider.id)).toBeNull()

        const after = await membershipOf(adminApi, setup.target.id)
        expect(after?.role.id).toBe(setup.narrowRole.id)
    })

    test('cannot add a permission it does not hold to its own role', async ({
        api,
        adminApi,
        apiAs,
        createUser,
        testPrefix,
    }) => {
        const setup = await managerSetup({
            api,
            adminApi,
            apiAs,
            createUser,
            testPrefix,
        })

        await expect(
            setRolePermissions(setup.managerApi, setup.managerRole.id, [
                'manage_users',
                'manage_settings',
            ]),
        ).rejects.toMatchObject({ status: 403 })

        const role = await findRole(adminApi, setup.managerRole.name)
        expect(role.permissions).not.toContain('manage_settings')
    })

    test('can assign a role within its own permissions', async ({
        api,
        adminApi,
        apiAs,
        createUser,
        testPrefix,
    }) => {
        const setup = await managerSetup({
            api,
            adminApi,
            apiAs,
            createUser,
            testPrefix,
        })
        const target = await membershipOf(adminApi, setup.target.id)
        const moved = await changeMembershipRole(
            setup.managerApi,
            target!.id,
            setup.managerRole.id,
        )

        expect(moved.role).toBe(setup.managerRole.id)
    })
})
