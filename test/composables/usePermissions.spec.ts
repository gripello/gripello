import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref as vueRef, toRef } from 'vue'

// ── Nuxt auto-import stubs ──────────────────────────────────────────────────
const useStateMocks: Record<string, unknown> = reactive({})

vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
    if (!(key in useStateMocks)) {
        useStateMocks[key] = init ? init() : undefined
    }
    return toRef(useStateMocks, key)
})

vi.stubGlobal('ref', vueRef)

vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))

const notifyErrorMock = vi.fn()
vi.stubGlobal('useNotification', () => ({ error: notifyErrorMock }))

let pbMock: any

vi.stubGlobal('usePocketbase', () => pbMock)

const currentGym = vueRef('gymA')
vi.stubGlobal('useCurrentGymId', () => currentGym)

function membership(gym: string, role: string, permissions: string[]) {
    return {
        gym,
        role: `${role}-${gym}`,
        expand: {
            role: {
                name: role,
                expand: { permissions: permissions.map((name) => ({ name })) },
            },
        },
    }
}

function userWith(...memberships: ReturnType<typeof membership>[]) {
    return { expand: { memberships_via_user: memberships } }
}

function memberOf(role: string, permissions: string[], gym = 'gymA') {
    return userWith(membership(gym, role, permissions))
}

describe('usePermissions', () => {
    beforeEach(() => {
        vi.resetModules()
        for (const key of Object.keys(useStateMocks)) {
            delete useStateMocks[key]
        }
        currentGym.value = 'gymA'
        pbMock = {
            authStore: {
                isValid: true,
                record: { id: 'user123' },
            },
            collection: vi.fn(),
            cancelRequest: vi.fn(),
        }
    })

    async function loadComposable() {
        const mod = await import('~/composables/usePermissions')
        return mod.usePermissions()
    }

    // ── can() before loading ─────────────────────────────────────────────

    it('denies every feature before permissions are loaded', async () => {
        const { can } = await loadComposable()

        expect(can('manage_routes')).toBe(false)
        expect(can('anything')).toBe(false)
    })

    // ── refreshPermissions ───────────────────────────────────────────────

    it('fetches role with expanded permissions and populates can()', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi
                .fn()
                .mockResolvedValue(
                    memberOf('routesetter', [
                        'manage_routes',
                        'view_analytics',
                        'manage_comments',
                    ]),
                ),
        })

        const { can, refreshPermissions, roleName } = await loadComposable()
        await refreshPermissions()

        expect(pbMock.collection).toHaveBeenCalledWith('users')
        expect(roleName()).toBe('routesetter')
        expect(can('manage_routes')).toBe(true)
        expect(can('view_analytics')).toBe(true)
        expect(can('manage_comments')).toBe(true)
        expect(can('manage_users')).toBe(false)
        expect(can('manage_settings')).toBe(false)
    })

    it('grants the admin role only its assigned permissions', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi
                .fn()
                .mockResolvedValue(memberOf('admin', ['manage_routes'])),
        })

        const { can, refreshPermissions } = await loadComposable()
        await refreshPermissions()

        expect(can('manage_routes')).toBe(true)
        expect(can('manage_users')).toBe(false)
    })

    it('lets platform admins manage settings and users of every gym', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi
                .fn()
                .mockResolvedValue({ ...userWith(), platform_admin: true }),
        })

        const { can, refreshPermissions } = await loadComposable()
        await refreshPermissions()

        expect(can('manage_settings', 'gymB')).toBe(true)
        expect(can('manage_users', 'gymB')).toBe(true)
        expect(can('manage_routes', 'gymB')).toBe(false)
    })

    it('user role with no permissions has no access', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi.fn().mockResolvedValue(memberOf('user', [])),
        })

        const { can, refreshPermissions } = await loadComposable()
        await refreshPermissions()

        expect(can('manage_routes')).toBe(false)
        expect(can('view_analytics')).toBe(false)
        expect(can('manage_users')).toBe(false)
        expect(can('manage_settings')).toBe(false)
        expect(can('manage_comments')).toBe(false)
        expect(can('run_inventory')).toBe(false)
    })

    // ── Unauthenticated / no role ────────────────────────────────────────

    it('clears permissions when user is not authenticated', async () => {
        pbMock.authStore.isValid = false
        pbMock.authStore.record = null

        const { can, refreshPermissions, loaded } = await loadComposable()
        await refreshPermissions()

        expect(loaded.value).toBe(true)
        expect(can('manage_routes')).toBe(false)
        expect(can('manage_users')).toBe(false)
    })

    it('a climber without memberships has no access', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi.fn().mockResolvedValue(userWith()),
        })

        const { can, refreshPermissions } = await loadComposable()
        await refreshPermissions()

        expect(can('manage_routes')).toBe(false)
        expect(can('manage_users')).toBe(false)
    })

    // ── Error handling ───────────────────────────────────────────────────

    it('clears permissions on fetch error', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi.fn().mockRejectedValue(new Error('Network error')),
        })

        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {})
        const { can, refreshPermissions, roleName } = await loadComposable()
        await refreshPermissions()

        expect(roleName()).toBe('')
        expect(can('manage_routes')).toBe(false)
        consoleError.mockRestore()
    })

    it('keeps permissions and stays quiet when a refresh is auto-cancelled', async () => {
        const autoCancel = Object.assign(new Error('autocancelled'), {
            isAbort: true,
            status: 0,
        })
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi
                .fn()
                .mockResolvedValueOnce(
                    memberOf('routesetter', ['manage_routes']),
                )
                .mockRejectedValueOnce(autoCancel),
        })

        const { can, refreshPermissions, roleName } = await loadComposable()
        await refreshPermissions()
        notifyErrorMock.mockClear()

        await refreshPermissions()

        expect(notifyErrorMock).not.toHaveBeenCalled()
        expect(roleName()).toBe('routesetter')
        expect(can('manage_routes')).toBe(true)
    })

    it('still reports a genuine fetch failure', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi
                .fn()
                .mockRejectedValue(
                    Object.assign(new Error('boom'), { status: 500 }),
                ),
        })

        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {})
        notifyErrorMock.mockClear()
        const { refreshPermissions } = await loadComposable()
        await refreshPermissions()

        expect(notifyErrorMock).toHaveBeenCalled()
        consoleError.mockRestore()
    })

    it('reports a failure without needing the Nuxt instance after the request', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi
                .fn()
                .mockRejectedValue(
                    Object.assign(new Error('gone'), { status: 404 }),
                ),
        })
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {})
        notifyErrorMock.mockClear()
        const { refreshPermissions } = await loadComposable()

        const nuxtApp = globalThis.useNuxtApp
        const outsideNuxt = () => {
            throw new Error('NUXT_E1001')
        }
        vi.stubGlobal('useNuxtApp', outsideNuxt)
        vi.stubGlobal('useNotification', outsideNuxt)
        try {
            await expect(refreshPermissions()).resolves.toBeUndefined()
            expect(notifyErrorMock).toHaveBeenCalled()
        } finally {
            vi.stubGlobal('useNuxtApp', nuxtApp)
            vi.stubGlobal('useNotification', () => ({ error: notifyErrorMock }))
            consoleError.mockRestore()
        }
    })

    it('handles role with no expanded permissions gracefully', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi.fn().mockResolvedValue(userWith()),
        })

        const { can, refreshPermissions } = await loadComposable()
        await refreshPermissions()

        expect(can('manage_routes')).toBe(false)
    })

    // ── ensureLoaded ─────────────────────────────────────────────────────

    it('ensureLoaded fetches permissions only once', async () => {
        const getOneMock = vi
            .fn()
            .mockResolvedValue(memberOf('routesetter', ['manage_routes']))
        pbMock.collection = vi.fn().mockReturnValue({ getOne: getOneMock })

        const { ensureLoaded, can } = await loadComposable()

        await ensureLoaded()
        await ensureLoaded()
        await ensureLoaded()

        expect(getOneMock).toHaveBeenCalledTimes(1)
        expect(can('manage_routes')).toBe(true)
    })

    it('ensureLoaded reloads after a guest visit once the user signs in', async () => {
        const getOneMock = vi
            .fn()
            .mockResolvedValue(memberOf('routesetter', ['manage_routes']))
        pbMock.collection = vi.fn().mockReturnValue({ getOne: getOneMock })
        pbMock.authStore = { isValid: false, record: null }

        const { ensureLoaded, can } = await loadComposable()
        await ensureLoaded()
        expect(can('manage_routes')).toBe(false)

        pbMock.authStore = { isValid: true, record: { id: 'user123' } }
        await ensureLoaded()

        expect(getOneMock).toHaveBeenCalledTimes(1)
        expect(can('manage_routes')).toBe(true)
    })

    it('ensureLoaded clears permissions after logout', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi
                .fn()
                .mockResolvedValue(memberOf('routesetter', ['manage_routes'])),
        })

        const { ensureLoaded, can } = await loadComposable()
        await ensureLoaded()
        expect(can('manage_routes')).toBe(true)

        pbMock.authStore = { isValid: false, record: null }
        await ensureLoaded()

        expect(can('manage_routes')).toBe(false)
    })

    it('ensureLoaded reloads when the user changes', async () => {
        const getOneMock = vi
            .fn()
            .mockResolvedValueOnce(memberOf('user', []))
            .mockResolvedValueOnce(memberOf('routesetter', ['manage_routes']))
        pbMock.collection = vi.fn().mockReturnValue({ getOne: getOneMock })

        const { ensureLoaded, can } = await loadComposable()
        await ensureLoaded()
        pbMock.authStore.record = { id: 'user456' }
        await ensureLoaded()

        expect(getOneMock).toHaveBeenLastCalledWith(
            'user456',
            expect.anything(),
        )
        expect(can('manage_routes')).toBe(true)
    })

    it('drops an in-flight role fetch when the user signs out', async () => {
        let resolveRole: (value: unknown) => void = () => {}
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi.fn(
                () => new Promise((resolve) => (resolveRole = resolve)),
            ),
        })

        const { ensureLoaded, refreshPermissions, can } = await loadComposable()
        const inFlight = ensureLoaded()

        pbMock.authStore = { isValid: false, record: null }
        await refreshPermissions()
        resolveRole(memberOf('routesetter', ['manage_routes']))
        await inFlight

        expect(pbMock.cancelRequest).toHaveBeenCalledWith('userPermissions')
        expect(can('manage_routes')).toBe(false)
    })

    it('separate callers share one in-flight role fetch', async () => {
        let resolveRole: (value: unknown) => void = () => {}
        const getOneMock = vi.fn(
            () => new Promise((resolve) => (resolveRole = resolve)),
        )
        pbMock.collection = vi.fn().mockReturnValue({ getOne: getOneMock })

        const mod = await import('~/composables/usePermissions')
        const plugin = mod.usePermissions()
        const middleware = mod.usePermissions()
        const pluginLoad = plugin.ensureLoaded()
        const middlewareLoad = middleware.ensureLoaded()
        resolveRole(memberOf('routesetter', ['manage_routes']))
        await Promise.all([pluginLoad, middlewareLoad])

        expect(getOneMock).toHaveBeenCalledTimes(1)
        expect(middleware.can('manage_routes')).toBe(true)
    })

    it('a superseded ensureLoaded waits for the winning request', async () => {
        const autoCancel = Object.assign(new Error('autocancelled'), {
            isAbort: true,
            status: 0,
        })
        let rejectFirst: (err: unknown) => void = () => {}
        let resolveSecond: (value: unknown) => void = () => {}
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi
                .fn()
                .mockImplementationOnce(
                    () => new Promise((_, reject) => (rejectFirst = reject)),
                )
                .mockImplementationOnce(
                    () => new Promise((resolve) => (resolveSecond = resolve)),
                ),
        })

        const { ensureLoaded, refreshPermissions, can } = await loadComposable()
        let firstSettled = false
        const first = ensureLoaded().then(() => (firstSettled = true))

        pbMock.authStore.record = { id: 'user456' }
        const second = refreshPermissions()
        rejectFirst(autoCancel)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(firstSettled).toBe(false)

        resolveSecond(memberOf('routesetter', ['manage_routes']))
        await Promise.all([first, second])

        expect(can('manage_routes')).toBe(true)
    })

    // ── Permission refresh updates results ───────────────────────────────

    it('refreshPermissions updates can() results when role changes', async () => {
        const getOneMock = vi
            .fn()
            .mockResolvedValueOnce(
                memberOf('routesetter', ['manage_routes', 'view_analytics']),
            )
            .mockResolvedValueOnce(memberOf('user', []))
        pbMock.collection = vi.fn().mockReturnValue({ getOne: getOneMock })

        const { can, refreshPermissions, roleName } = await loadComposable()

        await refreshPermissions()
        expect(roleName()).toBe('routesetter')
        expect(can('manage_routes')).toBe(true)
        expect(can('manage_users')).toBe(false)

        await refreshPermissions()
        expect(roleName()).toBe('user')
        expect(can('manage_routes')).toBe(false)
        expect(can('view_analytics')).toBe(false)
    })

    // ── per gym ──────────────────────────────────────────────────────────

    it('grants permissions only in the gym of the membership', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi
                .fn()
                .mockResolvedValue(
                    userWith(
                        membership('gymA', 'routesetter', ['manage_routes']),
                        membership('gymB', 'analyst', ['view_analytics']),
                    ),
                ),
        })

        const { can, refreshPermissions, roleName } = await loadComposable()
        await refreshPermissions()

        expect(can('manage_routes')).toBe(true)
        expect(can('view_analytics')).toBe(false)
        expect(can('view_analytics', 'gymB')).toBe(true)
        expect(can('manage_routes', 'gymC')).toBe(false)
        expect(roleName('gymB')).toBe('analyst')

        currentGym.value = 'gymB'
        expect(can('manage_routes')).toBe(false)
        expect(can('view_analytics')).toBe(true)
        expect(roleName()).toBe('analyst')
    })

    it('expands all memberships in one request', async () => {
        const getOneMock = vi.fn().mockResolvedValue(userWith())
        pbMock.collection = vi.fn().mockReturnValue({ getOne: getOneMock })

        const { refreshPermissions } = await loadComposable()
        await refreshPermissions()

        expect(getOneMock).toHaveBeenCalledWith('user123', {
            expand: 'memberships_via_user.gym,memberships_via_user.role.permissions',
            requestKey: 'userPermissions',
        })
    })

    // ── loaded state ─────────────────────────────────────────────────────

    it('sets loaded to true after successful refresh', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi.fn().mockResolvedValue(memberOf('user', [])),
        })

        const { loaded, refreshPermissions } = await loadComposable()

        expect(loaded.value).toBe(false)
        await refreshPermissions()
        expect(loaded.value).toBe(true)
    })

    it('sets loaded to true even after error', async () => {
        pbMock.collection = vi.fn().mockReturnValue({
            getOne: vi.fn().mockRejectedValue(new Error('fail')),
        })

        vi.spyOn(console, 'error').mockImplementation(() => {})
        const { loaded, refreshPermissions } = await loadComposable()

        await refreshPermissions()
        expect(loaded.value).toBe(true)
    })
})
