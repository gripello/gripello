import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref as vueRef } from 'vue'

const useStateMocks: Record<string, { value: unknown }> = {}
vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
    if (!useStateMocks[key]) useStateMocks[key] = vueRef(init?.())
    return useStateMocks[key]
})

let pbMock: any
vi.stubGlobal('usePocketbase', () => pbMock)

describe('useFollowedWalls', () => {
    let update: ReturnType<typeof vi.fn>

    beforeEach(() => {
        vi.resetModules()
        for (const key of Object.keys(useStateMocks)) delete useStateMocks[key]
        update = vi
            .fn()
            .mockResolvedValue({ id: 'u1', followed_walls: ['w1', 'w2'] })
        pbMock = {
            authStore: {
                token: 't',
                record: { id: 'u1', followed_walls: ['w1'] },
                save: vi.fn(),
            },
            collection: vi.fn().mockReturnValue({ update }),
        }
    })

    async function load() {
        const mod = await import('~/composables/useFollowedWalls')
        return mod.useFollowedWalls()
    }

    it('adds a wall with the relation modifier so other devices are not overwritten', async () => {
        const walls = await load()
        await walls.setFollowing('w2', true)
        expect(update).toHaveBeenCalledWith('u1', { 'followed_walls+': 'w2' })
        expect(walls.isFollowing('w2')).toBe(true)
    })

    it('removes a wall', async () => {
        const walls = await load()
        await walls.setFollowing('w1', false)
        expect(update).toHaveBeenCalledWith('u1', { 'followed_walls-': 'w1' })
        expect(walls.isFollowing('w1')).toBe(false)
    })

    it('rolls back when saving fails', async () => {
        update.mockRejectedValue(new Error('offline'))
        const walls = await load()
        await expect(walls.setFollowing('w2', true)).rejects.toThrow()
        expect(walls.followed.value).toEqual(['w1'])
    })
})
