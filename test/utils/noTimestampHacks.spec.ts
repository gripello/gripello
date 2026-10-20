import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../..')
const SPACE_TO_T = /\.replace\(\s*(['"`]) \1\s*,\s*(['"`])T\2\s*\)/

const sourceFiles = (directory: string, recursive = true): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory())
            return recursive && entry.name !== 'node_modules'
                ? sourceFiles(fullPath)
                : []
        return /\.(vue|ts|mts|js)$/.test(entry.name) ? [fullPath] : []
    })

describe('timestamp parsing', () => {
    it('catches both quote styles', () => {
        expect(SPACE_TO_T.test(`value.replace(' ', 'T')`)).toBe(true)
        expect(SPACE_TO_T.test(`value.replace(" ", "T")`)).toBe(true)
    })

    it('never rewrites API timestamps by hand', () => {
        const files = [
            ...['app', 'shared', 'server', 'e2e/support']
                .map((dir) => path.join(root, dir))
                .filter(existsSync)
                .flatMap((dir) => sourceFiles(dir)),
            ...sourceFiles(path.join(root, 'loadtest'), false),
        ]
        expect(files.length).toBeGreaterThan(100)
        const offenders = files
            .filter((file) => SPACE_TO_T.test(readFileSync(file, 'utf8')))
            .map((file) => path.relative(root, file))
        expect(offenders).toEqual([])
    })
})
