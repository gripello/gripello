import { beforeEach, describe, expect, it, vi } from 'vitest'

const getGymMock = vi.fn()
vi.mock('~/api/gyms', () => ({ getGym: getGymMock }))

const gym = { value: null as { slug: string } | null }
const cookie = { value: 'home' as string | null }
vi.stubGlobal('defineNuxtRouteMiddleware', (handler: Function) => handler)
vi.stubGlobal('useGym', () => ({ gym }))
vi.stubGlobal('useGymCookie', () => cookie)
const routeSlug = { value: '' }
vi.stubGlobal('routeGymSlug', () => routeSlug.value)
const abortNavigation = vi.fn(() => false)
vi.stubGlobal('abortNavigation', abortNavigation)
vi.stubGlobal('createError', (input: object) =>
    Object.assign(new Error('gym'), input),
)

describe('gym middleware', () => {
    beforeEach(() => {
        gym.value = null
        cookie.value = 'home'
        routeSlug.value = ''
    })

    it('shows a retryable error page when a gym cannot be loaded right now', async () => {
        routeSlug.value = 'home'
        getGymMock.mockRejectedValueOnce({ status: 0 })
        const { default: middleware } = await import('~/middleware/gym.global')

        await expect(
            middleware({ path: '/home', fullPath: '/home', params: {} }),
        ).rejects.toMatchObject({ status: 503, fatal: true })
    })

    it('drops an aborted gym request without an error page', async () => {
        routeSlug.value = 'home'
        abortNavigation.mockClear()
        getGymMock.mockRejectedValueOnce({ status: 0, isAbort: true })
        const { default: middleware } = await import('~/middleware/gym.global')

        await expect(
            middleware({ path: '/home', fullPath: '/home', params: {} }),
        ).resolves.toBe(false)
        expect(abortNavigation).toHaveBeenCalledWith()
        expect(gym.value).toBeNull()
    })

    it('keeps the remembered gym when it cannot be loaded right now', async () => {
        getGymMock.mockRejectedValueOnce({ status: 0 })
        const { default: middleware } = await import('~/middleware/gym.global')

        await middleware({ path: '/logbook', fullPath: '/logbook', params: {} })
        expect(cookie.value).toBe('home')
        expect(gym.value).toBeNull()
    })

    it('forgets a remembered gym that no longer exists', async () => {
        getGymMock.mockResolvedValueOnce(null)
        const { default: middleware } = await import('~/middleware/gym.global')

        await middleware({ path: '/logbook', fullPath: '/logbook', params: {} })
        expect(cookie.value).toBeNull()
    })
})
