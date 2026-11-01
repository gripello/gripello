// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Reply = unknown | { status: number }
let replies: Record<string, Reply> = {}
const requested: string[] = []
let appVersion = ''
let handler: () => Promise<Record<string, unknown>>

const REPO = 'https://api.github.com/repos/gripello/gripello/'

beforeAll(async () => {
    vi.stubGlobal('defineCachedEventHandler', (fn: unknown) => fn)
    handler = (await import('../../server/api/version.get')).default as never
})

beforeEach(() => {
    replies = {}
    requested.length = 0
    vi.stubGlobal('useRuntimeConfig', () => ({
        github: { owner: 'gripello', repo: 'gripello', branch: 'main' },
        public: { appVersion },
    }))
    vi.mocked(globalThis.$fetch).mockImplementation(
        async (url: string, options: { headers: object }) => {
            const path = url.slice(REPO.length)
            requested.push(path)
            expect(options.headers).toMatchObject({ 'User-Agent': 'gripello' })
            const reply = replies[path]
            if (reply === undefined) throw { status: 404 }
            if (reply && typeof reply === 'object' && 'status' in reply)
                throw reply
            return reply
        },
    )
})

const release = (tag: string, body: string) => ({
    tag_name: tag,
    body,
    published_at: '2026-10-01T00:00:00Z',
})

const commit = (sha: string, message: string) => ({
    sha,
    commit: { message, author: { date: '2026-10-02T00:00:00Z' } },
})

async function check(version: string) {
    appVersion = version
    return handler()
}

describe('GET /api/version', () => {
    it('reuses the latest release for the installed notes when it is installed', async () => {
        replies['releases/latest'] = release('v1.2.0', 'Latest notes')
        const result = await check('1.2.0')
        expect(result).toMatchObject({
            mode: 'none',
            updateAvailable: false,
            error: null,
            installed: { base: '1.2.0', notes: 'Latest notes' },
            latest: { tag: 'v1.2.0', notes: 'Latest notes' },
            commits: [],
        })
        expect(requested).toEqual(['releases/latest'])
    })

    it('offers a newer release and reads the notes of the installed one', async () => {
        replies['releases/latest'] = release('v1.3.0', 'New')
        replies['releases/tags/v1.2.0'] = release('v1.2.0', 'Old')
        const result = await check('1.2.0')
        expect(result).toMatchObject({
            mode: 'release',
            updateAvailable: true,
            installed: { notes: 'Old' },
            latest: { tag: 'v1.3.0', notes: 'New' },
        })
    })

    it('lists the commits a dev build is behind, oldest first, and those since its release', async () => {
        replies['releases/latest'] = release('v1.2.0', 'Notes')
        replies['compare/abc1234...main'] = {
            ahead_by: 2,
            commits: [
                commit('1111111aaaa', 'fix: first\n\nbody'),
                commit('2222222bbbb', 'feat: second'),
            ],
        }
        replies['compare/v1.2.0...abc1234'] = {
            commits: [commit('3333333cccc', 'chore: mine')],
        }
        const result = await check('1.2.0-3-gabc1234')
        expect(result.mode).toBe('commit')
        expect(result.updateAvailable).toBe(true)
        expect(result.commits).toEqual([
            {
                sha: '2222222',
                message: 'feat: second',
                date: '2026-10-02T00:00:00Z',
            },
            {
                sha: '1111111',
                message: 'fix: first',
                date: '2026-10-02T00:00:00Z',
            },
        ])
        expect(result.installedCommits).toEqual([
            {
                sha: '3333333',
                message: 'chore: mine',
                date: '2026-10-02T00:00:00Z',
            },
        ])
    })

    it('treats a repository without releases as no update, not as an error', async () => {
        const result = await check('4f6a192')
        expect(result).toMatchObject({
            latest: null,
            mode: 'none',
            error: null,
            installedCommits: [],
        })
        expect(requested).toEqual(['releases/latest', 'compare/4f6a192...main'])
    })

    it('reports a GitHub rate limit apart from other failures', async () => {
        replies['releases/latest'] = { status: 403 }
        expect((await check('1.2.0')).error).toBe('rate_limited')

        replies['releases/latest'] = { status: 502 }
        const result = await check('1.2.0')
        expect(result).toMatchObject({
            error: 'unavailable',
            latest: null,
            updateAvailable: false,
        })
    })
})
