import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'

type Messages = { [key: string]: string | Messages }

const flatten = (messages: Messages, prefix = ''): Record<string, string> =>
    Object.fromEntries(
        Object.entries(messages).flatMap(([key, value]) =>
            typeof value === 'string'
                ? [[prefix + key, value]]
                : Object.entries(flatten(value, `${prefix}${key}.`)),
        ),
    )

const pluralKeys = new Set(
    Object.entries(flatten(en))
        .filter(([, value]) => value.includes(' | '))
        .map(([key]) => key),
)

const sourceFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory()) return sourceFiles(fullPath)
        return /\.(vue|ts)$/.test(entry.name) ? [fullPath] : []
    })

const topLevelArguments = (source: string, openParen: number): string[] => {
    const args: string[] = []
    let depth = 0
    let current = ''
    let quote: string | null = null
    for (let index = openParen + 1; index < source.length; index++) {
        const char = source[index]!
        if (quote) {
            current += char
            if (char === quote && source[index - 1] !== '\\') quote = null
            continue
        }
        if (char === "'" || char === '"' || char === '`') quote = char
        if ('({['.includes(char)) depth++
        if (')}]'.includes(char)) {
            if (depth === 0) break
            depth--
        }
        if (char === ',' && depth === 0) {
            args.push(current.trim())
            current = ''
            continue
        }
        current += char
    }
    if (current.trim()) args.push(current.trim())
    return args
}

const pluralCallsWithoutCount = () => {
    const appDirectory = path.resolve(import.meta.dirname, '../../app')
    const offenders: string[] = []
    for (const file of sourceFiles(appDirectory)) {
        const source = readFileSync(file, 'utf8')
        for (const match of source.matchAll(/(?<![\w.])\$?t\(\s*'([\w.]+)'/g)) {
            if (!pluralKeys.has(match[1]!)) continue
            const args = topLevelArguments(
                source,
                source.indexOf('(', match.index),
            )
            const hasCount =
                args.length >= 3 ||
                (args.length === 2 && !args[1]!.startsWith('{'))
            if (!hasCount)
                offenders.push(
                    `${path.relative(appDirectory, file)}: ${match[1]}`,
                )
        }
    }
    return offenders
}

describe('plural translation calls', () => {
    it('pass a plural count for every plural message', () => {
        expect(pluralCallsWithoutCount()).toEqual([])
    })
})
