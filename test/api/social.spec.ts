import { beforeEach, describe, expect, it } from 'vitest'
import {
    acceptFollow,
    createBlock,
    createFollow,
    deleteBlock,
    deleteFollow,
    getClimber,
    listBlocks,
    listClimberAchievements,
    listClimbersByIds,
    listFollows,
    searchClimbers,
} from '~/api/social'
import { ApiError } from '~/api/client'
import { mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

function calls() {
    return api.fetchMock.mock.calls.map((_, index) => {
        const { url, method, body } = api.request(index)
        return [method, url, body]
    })
}

describe('climbers', () => {
    it('searches, looks up, loads a profile and achievements', async () => {
        api.respond([
            { id: 'a', name: 'Ann Lee', avatar: '/a.png', banner: '' },
        ])
        expect(await searchClimbers('ann')).toEqual([
            { id: 'a', name: 'Ann Lee', avatar: '/a.png', banner: '' },
        ])
        await listClimbersByIds(['a', 'b'])
        await getClimber('a/b')
        await listClimberAchievements('a')
        expect(calls()).toEqual([
            ['GET', '/api/climbers?q=ann', undefined],
            ['GET', '/api/climbers?ids=a,b', undefined],
            ['GET', '/api/climbers/a%2Fb', undefined],
            ['GET', '/api/climbers/a/achievements', undefined],
        ])
    })

    it('throws an ApiError for a hidden profile', async () => {
        api.respond({ status: 404, message: 'Not found.', data: {} }, 404)
        const error = await getClimber('x').catch((err) => err)
        expect(error).toBeInstanceOf(ApiError)
        expect(error.status).toBe(404)
    })
})

describe('follows', () => {
    it('lists follows, narrowed by direction and status', async () => {
        await listFollows()
        await listFollows({ direction: 'followers', status: 'pending' })
        expect(calls()).toEqual([
            ['GET', '/api/me/follows', undefined],
            [
                'GET',
                '/api/me/follows?direction=followers&status=pending',
                undefined,
            ],
        ])
    })

    it('follows, accepts and deletes', async () => {
        await createFollow('u2')
        await acceptFollow('f1')
        await deleteFollow('f1')
        expect(calls()).toEqual([
            ['POST', '/api/follows', { followee: 'u2' }],
            ['POST', '/api/follows/f1/accept', undefined],
            ['DELETE', '/api/follows/f1', undefined],
        ])
    })
})

describe('blocks', () => {
    it('lists, creates and deletes blocks', async () => {
        await listBlocks()
        await createBlock('u2')
        await deleteBlock('b1')
        expect(calls()).toEqual([
            ['GET', '/api/me/blocks', undefined],
            ['POST', '/api/blocks', { blocked: 'u2' }],
            ['DELETE', '/api/blocks/b1', undefined],
        ])
    })
})
