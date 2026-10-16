import { describe, expect, it } from 'vitest'
import type { WallRecord } from '~/types/models'
import { defaultTvScreen, type TvAnnouncement } from '#shared/utils/tvSettings'
import {
    buildPlaylist,
    daysSinceSet,
    plannedResets,
    slideSeconds,
    takeoverCompetition,
    tvReloadDue,
    knownLocation,
    newTvScreenId,
    tvScreenUrl,
    tvSettingsPayload,
    type TvCompetition,
    type TvData,
    type TvRoute,
} from '~/utils/tvScreen'

const now = new Date('2026-10-14T18:00:00')

const route = (id: string, extra: Partial<TvRoute> = {}): TvRoute => ({
    id,
    name: id,
    screw_date: '2026-10-12 00:00:00.000Z',
    wall: 'w1',
    ...extra,
})
const wall = (id: string, name: string) =>
    ({ id, name, location: 'l1', outline: [], edge: [] }) as WallRecord
const competition = (
    id: string,
    starts_at: string,
    ends_at: string,
): TvCompetition => ({ id, name: id, status: 'open', starts_at, ends_at })

const DEFAULT_SCREEN = {
    ...defaultTvScreen(),
    announcements: [] as TvAnnouncement[],
}

const empty: TvData = { routes: [], walls: [], boards: [], competitions: [] }
const kinds = (data: Partial<TvData>, settings = DEFAULT_SCREEN) =>
    buildPlaylist(settings, { ...empty, ...data }, now, 'landscape').map(
        (slide) => slide.key,
    )

describe('buildPlaylist', () => {
    it('falls back to the info slide when nothing else has content', () => {
        expect(kinds({})).toEqual(['info'])
        expect(kinds({}, { ...DEFAULT_SCREEN, slides: [] })).toEqual(['info'])
    })

    it('pages new routes and caps them at two pages', () => {
        const routes = Array.from({ length: 30 }, (_, i) => route(`r${i}`))
        expect(kinds({ routes })).toEqual([
            'new_routes:0',
            'new_routes:1',
            'info',
        ])
        const portrait = buildPlaylist(
            DEFAULT_SCREEN,
            { ...empty, routes },
            now,
            'portrait',
        )
        expect(portrait[0]).toMatchObject({ kind: 'new_routes', pages: 2 })
        expect(
            portrait[0]!.kind === 'new_routes' && portrait[0]!.routes,
        ).toHaveLength(10)
    })

    it('leaves out routes set more than a week ago', () => {
        expect(
            kinds({ routes: [route('old', { screw_date: '2026-09-01' })] }),
        ).toEqual(['info'])
    })

    it('shows only boards with rows, ten rows each', () => {
        const rows = Array.from({ length: 15 }, (_, i) => ({
            rank: i + 1,
            user: `u${i}`,
            name: `U ${i}`,
            avatar: '',
            score: 100 - i,
            sends: 1,
            flashes: 0,
            hardest: '6a',
        }))
        const slides = buildPlaylist(
            DEFAULT_SCREEN,
            {
                ...empty,
                boards: [
                    { kind: 'boulder', rows },
                    { kind: 'route', rows: [] },
                ],
            },
            now,
            'landscape',
        )
        expect(slides[0]).toMatchObject({ kind: 'leaderboard' })
        expect(slides[0]!.kind === 'leaderboard' && slides[0]!.boards).toEqual([
            { kind: 'boulder', rows: rows.slice(0, 10) },
        ])
    })

    it('adds a promo for competitions open for registration', () => {
        expect(
            kinds({
                competitions: [
                    competition('soon', '2026-10-20 10:00', '2026-10-20 18:00'),
                    competition('now', '2026-10-14 10:00', '2026-10-14 22:00'),
                ],
            }),
        ).toEqual(['promo:soon', 'info'])
    })

    it('drops expired announcements and respects disabled slides', () => {
        const settings = {
            ...DEFAULT_SCREEN,
            slides: ['announcements' as const],
            announcements: [
                { text: ' Today ', until: '2026-10-14' },
                { text: 'Gone', until: '2026-10-13' },
                { text: 'Always' },
            ],
        }
        const slides = buildPlaylist(settings, empty, now, 'landscape')
        expect(
            slides.map((slide) => slide.kind === 'announcement' && slide.text),
        ).toEqual(['Today', 'Always'])
    })
})

describe('plannedResets', () => {
    it('groups future planned removals per wall and date', () => {
        const walls = [wall('w1', 'Cave'), wall('w2', 'Arete')]
        const resets = plannedResets(
            [
                route('a', { removal_planned_for: '2026-10-20' }),
                route('b', { removal_planned_for: '2026-10-20 00:00:00' }),
                route('c', { wall: 'w2', removal_planned_for: '2026-10-16' }),
                route('d', { removal_planned_for: '2026-10-01' }),
                route('e', {
                    removal_planned_for: '2026-10-20',
                    archived: true,
                }),
                route('f', { wall: 'gone', removal_planned_for: '2026-10-20' }),
            ],
            walls,
            now,
        )
        expect(
            resets.map((reset) => [reset.wall.name, reset.date, reset.count]),
        ).toEqual([
            ['Arete', '2026-10-16', 1],
            ['Cave', '2026-10-20', 2],
        ])
    })
})

describe('takeoverCompetition', () => {
    it('picks the running competition that ends first', () => {
        const competitions = [
            competition('late', '2026-10-14 10:00', '2026-10-15 22:00'),
            competition('early', '2026-10-14 10:00', '2026-10-14 20:00'),
            competition('soon', '2026-10-20 10:00', '2026-10-20 18:00'),
        ]
        expect(takeoverCompetition(competitions, now)?.id).toBe('early')
        expect(takeoverCompetition(competitions.slice(2), now)).toBeNull()
    })
})

describe('daysSinceSet', () => {
    it('counts whole days since the route was set', () => {
        expect(
            daysSinceSet(route('a', { screw_date: '2026-10-14' }), now),
        ).toBe(0)
        expect(daysSinceSet(route('b'), now)).toBe(2)
        expect(
            daysSinceSet(route('c', { screw_date: '2026-10-20' }), now),
        ).toBe(0)
        expect(daysSinceSet(route('d', { screw_date: null }), now)).toBeNull()
    })
})

describe('slideSeconds', () => {
    it('doubles the time of slides with a QR code', () => {
        const settings = { ...DEFAULT_SCREEN, seconds: 12 }
        expect(slideSeconds({ key: 'info', kind: 'info' }, settings)).toBe(24)
        expect(
            slideSeconds(
                { key: 'leaderboard', kind: 'leaderboard', boards: [] },
                settings,
            ),
        ).toBe(12)
    })
})

describe('tvSettingsPayload', () => {
    it('trims names and announcements and drops empty ones and blank dates', () => {
        expect(
            tvSettingsPayload({
                screens: [{ ...defaultTvScreen('a'), name: ' Entrance ' }],
                announcements: [
                    { text: '  Hi ', until: '' },
                    { text: '   ' },
                    { text: 'Bye', until: '2026-11-01' },
                ],
            }),
        ).toEqual({
            screens: [{ ...defaultTvScreen('a'), name: 'Entrance' }],
            announcements: [
                { text: 'Hi' },
                { text: 'Bye', until: '2026-11-01' },
            ],
        })
    })
})

describe('tvScreenUrl', () => {
    it('links the screen by its id', () => {
        expect(tvScreenUrl('https://x.app', 'gym', 'entrance')).toBe(
            'https://x.app/gym/tv?screen=entrance',
        )
    })
})

describe('knownLocation', () => {
    it('falls back to the whole gym for a deleted location', () => {
        expect(knownLocation('l1', [{ id: 'l1' }])).toBe('l1')
        expect(knownLocation('gone', [{ id: 'l1' }])).toBe('')
        expect(knownLocation('', [])).toBe('')
    })
})

describe('newTvScreenId', () => {
    it('makes ids the settings accept', () => {
        expect(newTvScreenId()).toMatch(/^[a-z0-9]{8}$/)
        expect(newTvScreenId()).not.toBe(newTvScreenId())
    })
})

describe('tvReloadDue', () => {
    const at = (time: string) => new Date(`2026-10-14T${time}:00`)

    it('reloads for a new build only after ten minutes of uptime', () => {
        expect(tvReloadDue('update', at('12:00'), at('12:05'))).toBe(false)
        expect(tvReloadDue('update', at('12:00'), at('12:10'))).toBe(true)
    })

    it('reloads once a night after four', () => {
        const yesterday = new Date('2026-10-13T20:00:00')
        expect(tvReloadDue('nightly', yesterday, at('03:59'))).toBe(false)
        expect(tvReloadDue('nightly', yesterday, at('04:01'))).toBe(true)
        expect(tvReloadDue('nightly', at('04:01'), at('05:00'))).toBe(false)
    })
})
