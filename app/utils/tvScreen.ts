import type { CompetitionRecord, WallRecord } from '~/types/models'
import type { LeaderboardRow } from '~/utils/leaderboard'
import type { LogbookKind } from '#shared/utils/logbook'
import { localDay } from '#shared/utils/ticks'
import type {
    ResolvedTvScreen,
    ResolvedTvSettings,
    TvAnnouncement,
    TvSettings,
} from '#shared/utils/tvSettings'
import { competitionPhase } from '~/utils/competitions'
import { newRoutes, type OverviewRoute } from '~/utils/overview'

export const TV_NEW_ROUTE_DAYS = 7
export const TV_ROUTE_PAGES = 2
export const TV_ROUTES_PER_PAGE = { landscape: 8, portrait: 10 } as const
export const TV_BOARD_ROWS = 10
export const TV_RESET_WALLS = 8

export type TvOrientation = keyof typeof TV_ROUTES_PER_PAGE

export interface TvRoute extends OverviewRoute {
    color?: string | null
    removal_planned_for?: string | null
    archived?: boolean
}

export interface TvBoard {
    kind: LogbookKind
    rows: LeaderboardRow[]
}

export interface TvReset {
    wall: WallRecord
    date: string
    count: number
}

export type TvCompetition = Pick<
    CompetitionRecord,
    'id' | 'name' | 'status' | 'starts_at' | 'ends_at'
>

export interface TvData<Route extends TvRoute = TvRoute> {
    routes: Route[]
    walls: WallRecord[]
    boards: TvBoard[]
    competitions: TvCompetition[]
}

export type TvSlide<Route extends TvRoute = TvRoute> = { key: string } & (
    | { kind: 'new_routes'; routes: Route[]; page: number; pages: number }
    | { kind: 'leaderboard'; boards: TvBoard[] }
    | { kind: 'resets'; resets: TvReset[] }
    | { kind: 'promo'; competition: TvCompetition }
    | { kind: 'announcement'; text: string }
    | { kind: 'info' }
)

export const slideHasQr = (slide: TvSlide) =>
    slide.kind === 'info' || slide.kind === 'promo'

export const slideSeconds = (
    slide: TvSlide,
    screen: Pick<ResolvedTvScreen, 'seconds'>,
) => screen.seconds * (slideHasQr(slide) ? 2 : 1)

export function plannedResets(
    routes: TvRoute[],
    walls: WallRecord[],
    now: Date,
): TvReset[] {
    const today = localDay(now)
    const counts = new Map<string, number>()
    for (const route of routes) {
        const date = route.removal_planned_for?.slice(0, 10)
        if (!route.wall || route.archived || !date || date < today) continue
        const key = `${route.wall}|${date}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const wallById = new Map(walls.map((wall) => [wall.id, wall]))
    return [...counts]
        .flatMap(([key, count]) => {
            const [wallId, date] = key.split('|') as [string, string]
            const wall = wallById.get(wallId)
            return wall ? [{ wall, date, count }] : []
        })
        .sort(
            (a, b) =>
                a.date.localeCompare(b.date) ||
                a.wall.name.localeCompare(b.wall.name),
        )
}

export function daysSinceSet(route: TvRoute, now: Date) {
    const day = route.screw_date?.slice(0, 10)
    if (!day) return null
    return Math.max(
        0,
        Math.round((Date.parse(localDay(now)) - Date.parse(day)) / 86_400_000),
    )
}

const activeAnnouncements = (announcements: TvAnnouncement[], now: Date) =>
    announcements.filter(
        (announcement) =>
            !announcement.until || announcement.until >= localDay(now),
    )

export function takeoverCompetition<Competition extends TvCompetition>(
    competitions: Competition[],
    now: Date,
): Competition | null {
    return (
        competitions
            .filter(
                (competition) =>
                    competitionPhase(competition, now) === 'running',
            )
            .sort((a, b) => a.ends_at.localeCompare(b.ends_at))[0] ?? null
    )
}

export function buildPlaylist<Route extends TvRoute>(
    settings: Pick<ResolvedTvScreen, 'slides'> &
        Pick<ResolvedTvSettings, 'announcements'>,
    data: TvData<Route>,
    now: Date,
    orientation: TvOrientation,
): TvSlide<Route>[] {
    const enabled = new Set(settings.slides)
    const slides: TvSlide<Route>[] = []
    if (enabled.has('new_routes')) {
        const perPage = TV_ROUTES_PER_PAGE[orientation]
        const fresh = newRoutes(data.routes, now, TV_NEW_ROUTE_DAYS).slice(
            0,
            perPage * TV_ROUTE_PAGES,
        )
        const pages = Math.ceil(fresh.length / perPage)
        for (let page = 0; page < pages; page++)
            slides.push({
                key: `new_routes:${page}`,
                kind: 'new_routes',
                routes: fresh.slice(page * perPage, (page + 1) * perPage),
                page,
                pages,
            })
    }
    if (enabled.has('leaderboard')) {
        const boards = data.boards
            .filter((board) => board.rows.length)
            .map((board) => ({
                ...board,
                rows: board.rows.slice(0, TV_BOARD_ROWS),
            }))
        if (boards.length)
            slides.push({ key: 'leaderboard', kind: 'leaderboard', boards })
    }
    if (enabled.has('resets')) {
        const resets = plannedResets(data.routes, data.walls, now).slice(
            0,
            TV_RESET_WALLS,
        )
        if (resets.length)
            slides.push({ key: 'resets', kind: 'resets', resets })
    }
    for (const competition of data.competitions) {
        if (competitionPhase(competition, now) === 'registration')
            slides.push({
                key: `promo:${competition.id}`,
                kind: 'promo',
                competition,
            })
    }
    if (enabled.has('announcements')) {
        activeAnnouncements(settings.announcements, now).forEach(
            (announcement, index) =>
                slides.push({
                    key: `announcement:${index}`,
                    kind: 'announcement',
                    text: announcement.text.trim(),
                }),
        )
    }
    if (enabled.has('info') || !slides.length)
        slides.push({ key: 'info', kind: 'info' })
    return slides
}

export function tvSettingsPayload(settings: ResolvedTvSettings): TvSettings {
    return {
        screens: settings.screens.map((screen) => ({
            ...screen,
            name: screen.name.trim(),
        })),
        announcements: settings.announcements
            .map((announcement) => ({
                text: announcement.text.trim(),
                ...(announcement.until ? { until: announcement.until } : {}),
            }))
            .filter((announcement) => announcement.text),
    }
}

export const knownLocation = (id: string, locations: { id: string }[]) =>
    locations.some((entry) => entry.id === id) ? id : ''

export const newTvScreenId = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
        (byte % 36).toString(36),
    ).join('')

export const tvScreenUrl = (
    origin: string,
    gymSlug: string,
    screenId: string,
) => `${origin}/${gymSlug}/tv?screen=${encodeURIComponent(screenId)}`

export const TV_MIN_UPTIME_MS = 10 * 60_000
export const TV_NIGHTLY_RELOAD_HOUR = 4

export function tvReloadDue(
    reason: 'update' | 'nightly',
    loadedAt: Date,
    now: Date,
) {
    if (now.getTime() - loadedAt.getTime() < TV_MIN_UPTIME_MS) return false
    if (reason === 'update') return true
    const nightly = new Date(now)
    nightly.setHours(TV_NIGHTLY_RELOAD_HOUR, 0, 0, 0)
    return now >= nightly && loadedAt < nightly
}
