import PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { e2eGymId, ensureUser, getRoleIds } from '../../support/seed'

async function membershipOf(root: PocketBase, user: string) {
    return root
        .collection('memberships')
        .getFirstListItem(
            root.filter('user = {:user} && gym = {:gym}', {
                user,
                gym: await e2eGymId(root),
            }),
            { requestKey: null },
        )
        .catch(() => null)
}

const PB_URL = process.env.E2E_PB_URL || 'https://localhost'

async function throwaway(
    admin: PocketBase,
    role: 'user' | 'admin',
    prefix: string,
) {
    const roleIds = await getRoleIds(admin)
    const seeded = await ensureUser(admin, roleIds[role], role, prefix)

    const pb = new PocketBase(PB_URL)
    await pb.collection('users').authWithPassword(seeded.email, seeded.password)

    return { pb, id: seeded.id, roleId: roleIds[role] }
}

test.describe('role escalation guard', () => {
    test('a plain member cannot give themselves the admin role', async ({
        root,
        testPrefix,
    }) => {
        const { pb, id } = await throwaway(root, 'user', testPrefix)
        const adminRole = (await getRoleIds(root)).admin

        await expect(
            pb.collection('memberships').create({
                user: id,
                gym: await e2eGymId(root),
                role: adminRole,
            }),
        ).rejects.toMatchObject({ status: 400 })

        expect(await membershipOf(root, id)).toBeNull()
    })

    test('a plain member can still edit their own profile', async ({
        root,
        testPrefix,
    }) => {
        const { pb, id } = await throwaway(root, 'user', testPrefix)

        const updated = await pb
            .collection('users')
            .update(id, { firstname: 'Guarded' })

        expect(updated.firstname).toBe('Guarded')
    })

    test('manage_users can still assign a role', async ({
        root,
        testPrefix,
    }) => {
        const manager = await throwaway(root, 'admin', `${testPrefix}-mgr`)
        const target = await throwaway(root, 'user', `${testPrefix}-tgt`)

        const setterRole = (await getRoleIds(root)).routesetter
        expect(target.roleId).not.toBe(setterRole)

        const moved = await manager.pb.collection('memberships').create({
            user: target.id,
            gym: await e2eGymId(root),
            role: setterRole,
        })

        expect(moved.role).toBe(setterRole)
    })
})

test.describe('user manager without admin role', () => {
    let root: PocketBase

    test.beforeAll(async ({ root: workerRoot }) => {
        root = workerRoot
    })

    async function permissionIds(names: string[]) {
        const records = await root
            .collection('permissions')
            .getFullList({ requestKey: null })
        return records
            .filter((record) => names.includes(record.name))
            .map((record) => record.id)
    }

    async function managerSetup(prefix: string) {
        const managerRole = await root.collection('roles').create({
            gym: await e2eGymId(root),
            name: `${prefix}-mgr-role`,
            permissions: await permissionIds(['manage_users']),
        })
        const narrowRole = await root.collection('roles').create({
            gym: await e2eGymId(root),
            name: `${prefix}-narrow-role`,
            permissions: [],
        })
        const manager = await ensureUser(
            root,
            managerRole.id,
            'user',
            `${prefix}-mgr`,
        )
        const target = await ensureUser(
            root,
            narrowRole.id,
            'user',
            `${prefix}-tgt`,
        )
        const pb = new PocketBase(PB_URL)
        await pb
            .collection('users')
            .authWithPassword(manager.email, manager.password)
        return { pb, managerRole, narrowRole, manager, target }
    }

    async function teardown(setup: Awaited<ReturnType<typeof managerSetup>>) {
        for (const id of [setup.manager.id, setup.target.id]) {
            await root
                .collection('users')
                .delete(id, { requestKey: null })
                .catch(() => {})
        }
        for (const id of [setup.managerRole.id, setup.narrowRole.id]) {
            await root
                .collection('roles')
                .delete(id, { requestKey: null })
                .catch(() => {})
        }
    }

    test('cannot give the admin role to anyone', async ({}, info) => {
        const setup = await managerSetup(
            `guard-noadm-w${info.workerIndex}-${Date.now()}`,
        )
        try {
            const adminRole = (await getRoleIds(root)).admin
            const memberships = setup.pb.collection('memberships')
            const own = await membershipOf(root, setup.manager.id)
            const target = await membershipOf(root, setup.target.id)

            await expect(
                memberships.update(own!.id, { role: adminRole }),
            ).rejects.toMatchObject({ status: 403 })
            await expect(
                memberships.update(target!.id, { role: adminRole }),
            ).rejects.toMatchObject({ status: 403 })
            const outsider = await ensureUser(
                root,
                undefined,
                'user',
                `${setup.managerRole.name}-out`,
            )
            try {
                await expect(
                    setup.pb.send(`/api/gyms/${await e2eGymId(root)}/members`, {
                        method: 'POST',
                        body: { email: outsider.email, role: adminRole },
                    }),
                ).rejects.toMatchObject({ status: 403 })
                expect(await membershipOf(root, outsider.id)).toBeNull()
            } finally {
                await root.collection('users').delete(outsider.id)
            }

            const after = await membershipOf(root, setup.target.id)
            expect(after?.role).toBe(setup.narrowRole.id)
        } finally {
            await teardown(setup)
        }
    })

    test('cannot add a permission it does not hold to its own role', async ({}, info) => {
        const setup = await managerSetup(
            `guard-perm-w${info.workerIndex}-${Date.now()}`,
        )
        try {
            const [settingsPermission] = await permissionIds([
                'manage_settings',
            ])

            await expect(
                setup.pb.collection('roles').update(setup.managerRole.id, {
                    'permissions+': settingsPermission,
                }),
            ).rejects.toMatchObject({ status: 403 })

            const role = await root
                .collection('roles')
                .getOne(setup.managerRole.id)
            expect(role.permissions).not.toContain(settingsPermission)
        } finally {
            await teardown(setup)
        }
    })

    test('can assign a role within its own permissions', async ({}, info) => {
        const setup = await managerSetup(
            `guard-sub-w${info.workerIndex}-${Date.now()}`,
        )
        try {
            const target = await membershipOf(root, setup.target.id)
            const moved = await setup.pb
                .collection('memberships')
                .update(target!.id, { role: setup.managerRole.id })

            expect(moved.role).toBe(setup.managerRole.id)
        } finally {
            await teardown(setup)
        }
    })
})
