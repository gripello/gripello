import { describe, expect, it } from 'vitest'
import fixtures from '../../backend/testdata/tvSettings.json'
import {
    defaultTvScreen,
    isValidTvSettings,
    tvScreenOf,
    tvSettingsOf,
} from '#shared/utils/tvSettings'

describe('tvSettings', () => {
    it.each(fixtures.valid)('accepts %j', (value) => {
        expect(isValidTvSettings(value)).toBe(true)
    })

    it.each(fixtures.invalid)('rejects %j', (value) => {
        expect(isValidTvSettings(value)).toBe(false)
    })

    it('fills unset fields with the defaults', () => {
        expect(tvSettingsOf(null)).toEqual({
            screens: [defaultTvScreen()],
            announcements: [],
        })
        expect(tvSettingsOf({ tv_settings: { screens: [] } }).screens).toEqual([
            defaultTvScreen(),
        ])
        expect(
            tvSettingsOf({
                tv_settings: {
                    screens: [{ id: 'a', seconds: 30, slides: [] }],
                },
            }).screens,
        ).toEqual([{ ...defaultTvScreen('a'), seconds: 30, slides: [] }])
    })

    it('picks the screen by id and falls back to the first', () => {
        const settings = tvSettingsOf({
            tv_settings: { screens: [{ id: 'a' }, { id: 'b', name: 'Bar' }] },
        })
        expect(tvScreenOf(settings, 'b').name).toBe('Bar')
        expect(tvScreenOf(settings, 'zz').id).toBe('a')
        expect(tvScreenOf(settings, '').id).toBe('a')
    })
})
