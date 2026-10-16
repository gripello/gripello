import { getLeaderboard, listSeasons } from '~/api/ticks'
import { localDay } from '#shared/utils/ticks'
import {
    LEADERBOARD_KINDS,
    ROLLING_SEASON,
    defaultSeason,
} from '~/utils/leaderboard'

export async function loadTvBoards(gymId: string, rows: number) {
    const nuxtApp = useNuxtApp()
    const seasons = await listSeasons(gymId)
    const current = defaultSeason(seasons, localDay(new Date()))
    const season = seasons.find((entry) => entry.id === current) ?? null
    const boards = await Promise.all(
        LEADERBOARD_KINDS.map((kind) =>
            nuxtApp
                .runWithContext(() =>
                    getLeaderboard(gymId, {
                        kind,
                        season: season?.id ?? ROLLING_SEASON,
                    }),
                )
                .then((board) => ({ kind, rows: board.rows.slice(0, rows) })),
        ),
    )
    return { season, boards }
}
