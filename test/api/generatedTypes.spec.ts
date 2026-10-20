import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import pkg from '../../package.json'

const modules = (dir: string, ext: string) =>
    readdirSync(dir)
        .filter((file) => file.endsWith(ext))
        .map((file) => file.slice(0, -ext.length))
        .sort()

describe('generated API types', () => {
    it('exist for exactly the OpenAPI fragments in api/', () => {
        expect(modules('types/api', '.ts')).toEqual(modules('api', '.yaml'))
    })

    it('come from a pinned openapi-typescript', () => {
        expect(pkg.scripts['api:types']).toMatch(
            /openapi-typescript@\d+\.\d+\.\d+ /,
        )
    })

    it('are derived, not hand-written, for the tick record', () => {
        const models = readFileSync('types/models.ts', 'utf8')
        expect(models).toMatch(/TicksApi\['schemas'\]\['Tick'\]/)
        expect(readFileSync('types/api/ticks.ts', 'utf8')).toMatch(
            /^\s+route: string;$/m,
        )
    })

    it('derive every wire record in types/models.ts', () => {
        const models = readFileSync('types/models.ts', 'utf8')
        expect(models).not.toMatch(/^export interface \w+Record\b/m)
        const records = [
            ...models.matchAll(/^export type (\w+Record) =\s*([^\n]*)/gm),
        ]
        expect(records.length).toBeGreaterThan(30)
        for (const [, name, definition] of records) {
            expect(definition, name).toMatch(
                /Api\[|^Omit<$|^Optional<$|^$|\w+Record\b/,
            )
        }
    })

    it('keep required lists next to the properties they require', () => {
        for (const file of modules('api', '.yaml')) {
            const lines = readFileSync(`api/${file}.yaml`, 'utf8').split('\n')
            lines.forEach((line, index) => {
                const required = line.match(/^(\s*)- type: object$/)
                if (!required) return
                const branch: string[] = []
                for (const next of lines.slice(index + 1)) {
                    if (!next.startsWith(`${required[1]}  `)) break
                    branch.push(next)
                }
                const list = branch
                    .join('\n')
                    .match(/^\s*required: \[([^\]]*)\]/m)?.[1]
                for (const field of list?.split(', ') ?? []) {
                    expect(
                        branch.some((entry) =>
                            new RegExp(`^\\s+${field}:`).test(entry),
                        ),
                        `${file}.yaml:${index + 1} requires ${field}`,
                    ).toBe(true)
                }
            })
        }
    })
})

const operationIds = (spec: string) =>
    [
        ...readFileSync(`api/${spec}.yaml`, 'utf8').matchAll(
            /operationId: (\w+)/g,
        ),
    ].map((match) => match[1])

const specsServedBy: Record<string, string[]> = {
    account: ['account', 'authn', 'members'],
    auth: ['authn'],
    client: ['system'],
    ratings: ['ratings', 'account'],
    social: ['social', 'achievements'],
}

const adapterHelpers: Record<string, string> = {
    'account.dataExportUrl': 'URL of downloadDataExport for the browser',
    'account.dataExportAvailable':
        'HEAD of downloadDataExport, so an expired link shows a message',
    'account.ownDataExportUrl': 'URL of downloadOwnDataExport for the browser',
    'auth.useAuthState': 'auth store accessor, no request',
    'auth.mfaRequired': 'reads the 401 body of login, no request',
    'backups.backupDownloadUrl': 'URL of downloadBackup for a browser download',
    'client.apiBaseURL': 'transport',
    'client.useApi': 'transport',
    'client.apiUrl': 'transport',
    'client.fileUrl': 'builds getFile URLs, no request',
    'client.toFormData': 'multipart encoding',
    'competitions.competitionDate': 'date normalisation, no request',
    'gyms.getGymById':
        'getGym by id without the slug lookup turning 404 and inactive gyms into null',
    'members.findRole': 'listRoles filtered to one name',
    'social.searchClimbers': 'listClimbers with ?q',
    'social.listClimbersByIds': 'listClimbers with ?ids, batched',
}

describe('API adapters', () => {
    it('are named after an operationId of the spec they serve', () => {
        const unnamed: string[] = []
        for (const adapter of modules('app/api', '.ts')) {
            const ids = new Set(
                (specsServedBy[adapter] ?? [adapter]).flatMap(operationIds),
            )
            const source = readFileSync(`app/api/${adapter}.ts`, 'utf8')
            for (const [, name] of source.matchAll(
                /^export (?:async )?function (\w+)/gm,
            )) {
                const key = `${adapter}.${name}`
                if (!ids.has(name!) && !(key in adapterHelpers))
                    unnamed.push(key)
            }
        }
        expect(unnamed).toEqual([])
    })

    it('list only helpers that still exist', () => {
        for (const key of Object.keys(adapterHelpers)) {
            const [adapter, name] = key.split('.')
            expect(readFileSync(`app/api/${adapter}.ts`, 'utf8'), key).toMatch(
                new RegExp(`^export (async )?function ${name}\\b`, 'm'),
            )
        }
    })
})
