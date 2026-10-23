import { keepShownOnError } from '~/utils/errors'

function store(data: unknown, { loaded = true, error = null as unknown } = {}) {
    return {
        _asyncData: { k: { data: { value: data }, error: { value: error } } },
        payload: { data: loaded ? { k: data } : {} },
    }
}

describe('keepShownOnError', () => {
    const failing = () => Promise.reject(new Error('503'))

    it('returns fresh data when the fetch succeeds', async () => {
        await expect(
            keepShownOnError('k', async () => 'new')(store('old')),
        ).resolves.toBe('new')
    })

    it('keeps the shown data when a refresh fails', async () => {
        await expect(
            keepShownOnError('k', failing)(store('old')),
        ).resolves.toBe('old')
    })

    it('fails when nothing was loaded yet or the last load failed', async () => {
        await expect(
            keepShownOnError('k', failing)(store([], { loaded: false })),
        ).rejects.toThrow('503')
        await expect(
            keepShownOnError(
                'k',
                failing,
            )(store('old', { error: new Error() })),
        ).rejects.toThrow('503')
    })
})
