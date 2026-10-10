import { describe, expect, it } from 'vitest'
import {
    checkApiVersion,
    isGoApiPath,
    parseSemver,
} from '#shared/utils/apiVersion'

describe('parseSemver', () => {
    it.each([
        ['', null],
        ['dev', null],
        ['v1.5.0', { major: 1, minor: 5, patch: 0 }],
        ['1.5.0-3-gabc', { major: 1, minor: 5, patch: 0 }],
    ])('%j', (input, expected) => {
        expect(parseSemver(input)).toEqual(expected)
    })
})

describe('checkApiVersion', () => {
    it.each([
        ['1.4.9', '1.5.0', 'outdated'],
        ['1.5.1', '1.5.0', 'outdated'],
        ['1.6.0', '1.5.0', 'unsupported'],
        ['2.0.0', '1.5.0', 'unsupported'],
        ['1.5.0', '1.5.0', 'ok'],
        ['1.5.0', 'dev', 'ok'],
        ['dev', '1.5.0', 'ok'],
    ])('%s against %s is %s', (client, server, expected) => {
        expect(checkApiVersion(client, server)).toBe(expected)
    })
})

describe('isGoApiPath', () => {
    it.each([
        ['/api/health', true],
        ['/api/files/users/u1/a.png', true],
        ['/api/uix', true],
        ['/api/ui/export', false],
        ['/api/manage/routes', false],
        ['/api/version', false],
        ['/api/cap/challenge', false],
        ['/routes', false],
    ])('%s', (path, expected) => {
        expect(isGoApiPath(path)).toBe(expected)
    })
})
