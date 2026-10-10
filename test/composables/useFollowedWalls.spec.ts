import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref as vueRef } from 'vue'

const useStateMocks: Record<string, { value: unknown }> = {}
vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
    if (!useStateMocks[key]) useStateMocks[key] = vueRef(init?.())
    return useStateMocks[key]
})

let pbMock: any
vi.stubGlobal('useAuthStore', () => pbMock.authStore)

const follow = vi.fn()
const unfollow = vi.fn()
vi.mock('~/api/account', () => ({
    followWall: (wall: string) => follow(wall),
    unfollowWall: (wall: string) => unfollow(wall),
}))

describe('useFollowedWalls', () => {
    beforeEach(() => {
        vi.resetModules()
        for (const key of Object.keys(useStateMocks)) delete useStateMocks[key]
        follow.mockReset().mockResolvedValue({ id: 'u1' })
        unfollow.mockReset().mockResolvedValue({ id: 'u1' })
        pbMock = {
            authStore: {
                token: 't',
                record: { id: 'u1', followed_walls: ['w1'] },
                save: vi.fn(),
            },
        }
    })

    async function load() {
        const mod = await import('~/composables/useFollowedWalls')
        return mod.useFollowedWalls()
    }

    it('adds a single wall so other devices are not overwritten', async () => {
        const walls = await load()
        await walls.setFollowing('w2', true)
        expect(follow).toHaveBeenCalledWith('w2')
        expect(walls.isFollowing('w2')).toBe(true)
    })

    it('removes a wall', async () => {
        const walls = await load()
        await walls.setFollowing('w1', false)
        expect(unfollow).toHaveBeenCalledWith('w1')
        expect(walls.isFollowing('w1')).toBe(false)
    })

    it('rolls back when saving fails', async () => {
        follow.mockRejectedValue(new Error('offline'))
        const walls = await load()
        await expect(walls.setFollowing('w2', true)).rejects.toThrow()
        expect(walls.followed.value).toEqual(['w1'])
    })
})
