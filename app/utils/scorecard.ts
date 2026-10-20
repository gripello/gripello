import type { ClimbStyle } from '#shared/utils/competitionScoring'

export interface ScoreState {
    attempts: number
    zoneAttempt: number
    topAttempt: number
    style: ClimbStyle | ''
}

export type ScoreAction =
    | { type: 'attempt' }
    | { type: 'undoAttempt' }
    | { type: 'zone' }
    | { type: 'top' }
    | { type: 'style'; style: ClimbStyle }

export const EMPTY_SCORE: ScoreState = {
    attempts: 0,
    zoneAttempt: 0,
    topAttempt: 0,
    style: '',
}

export function applyScoreAction(
    score: ScoreState,
    action: ScoreAction,
    hasZone: boolean,
): ScoreState {
    const attemptsAtLeastOne = Math.max(score.attempts, 1)
    switch (action.type) {
        case 'attempt':
            return score.topAttempt
                ? score
                : { ...score, attempts: score.attempts + 1 }
        case 'undoAttempt': {
            const floor = Math.max(score.topAttempt, score.zoneAttempt)
            return score.attempts > floor
                ? { ...score, attempts: score.attempts - 1 }
                : score
        }
        case 'zone':
            if (!hasZone || score.topAttempt) return score
            return score.zoneAttempt
                ? { ...score, zoneAttempt: 0 }
                : {
                      ...score,
                      attempts: attemptsAtLeastOne,
                      zoneAttempt: attemptsAtLeastOne,
                  }
        case 'top':
            if (score.topAttempt) {
                return {
                    ...score,
                    topAttempt: 0,
                    zoneAttempt:
                        score.zoneAttempt === score.topAttempt
                            ? 0
                            : score.zoneAttempt,
                }
            }
            return {
                ...score,
                attempts: attemptsAtLeastOne,
                topAttempt: attemptsAtLeastOne,
                zoneAttempt: hasZone
                    ? score.zoneAttempt || attemptsAtLeastOne
                    : 0,
            }
        case 'style':
            return { ...score, style: action.style }
    }
}

export function isFlash(score: ScoreState): boolean {
    return score.topAttempt === 1
}

export function scoreBody(score: ScoreState) {
    return {
        attempts: score.attempts,
        zone_attempt: score.zoneAttempt,
        top_attempt: score.topAttempt,
        style: score.style,
    }
}

export function scoreFromRecord(record: {
    attempts?: number | null
    zone_attempt?: number | null
    top_attempt?: number | null
    style?: ClimbStyle | '' | null
}): ScoreState {
    return {
        attempts: record.attempts ?? 0,
        zoneAttempt: record.zone_attempt ?? 0,
        topAttempt: record.top_attempt ?? 0,
        style: record.style ?? '',
    }
}

export type ScoreFlag = 'allFlashes' | 'uniqueTop'

export const ALL_FLASHES_MIN_TOPS = 5
export const UNIQUE_TOP_MIN_ENTRIES = 5

export function flagEntries(
    scores: {
        entry: string
        comp_route: string
        top_attempt?: number | null
    }[],
    entryCount: number,
): Map<string, ScoreFlag[]> {
    const tops = scores.filter((score) => (score.top_attempt ?? 0) > 0)
    const toppersByRoute = new Map<string, string[]>()
    const topsByEntry = new Map<string, number[]>()
    for (const score of tops) {
        toppersByRoute.set(score.comp_route, [
            ...(toppersByRoute.get(score.comp_route) ?? []),
            score.entry,
        ])
        topsByEntry.set(score.entry, [
            ...(topsByEntry.get(score.entry) ?? []),
            score.top_attempt!,
        ])
    }
    const flags = new Map<string, ScoreFlag[]>()
    const flag = (entry: string, value: ScoreFlag) => {
        const current = flags.get(entry) ?? []
        if (!current.includes(value)) flags.set(entry, [...current, value])
    }
    for (const [entry, attempts] of topsByEntry) {
        if (
            attempts.length >= ALL_FLASHES_MIN_TOPS &&
            attempts.every((attempt) => attempt === 1)
        ) {
            flag(entry, 'allFlashes')
        }
    }
    if (entryCount >= UNIQUE_TOP_MIN_ENTRIES) {
        for (const toppers of toppersByRoute.values()) {
            if (toppers.length === 1) flag(toppers[0]!, 'uniqueTop')
        }
    }
    return flags
}

export function replaceEntryScores<T extends { entry: string }>(
    scores: T[],
    entries: Iterable<string>,
    fresh: T[],
): T[] {
    const replaced = new Set(entries)
    return [...scores.filter((score) => !replaced.has(score.entry)), ...fresh]
}

export const scoreKey = (entry: string, compRoute: string) =>
    `${entry}:${compRoute}`

export function supersededUnsavedKeys(
    unsaved: Map<string, { base: string | undefined }>,
    scores: { entry: string; comp_route: string; updated?: string }[],
): string[] {
    const updatedByKey = new Map(
        scores.map((score) => [
            scoreKey(score.entry, score.comp_route),
            score.updated,
        ]),
    )
    return [...unsaved]
        .filter(([key, { base }]) => updatedByKey.get(key) !== base)
        .map(([key]) => key)
}
