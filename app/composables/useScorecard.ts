import { useEventListener } from '@vueuse/core'
import { COMPETITION_SCORES_KEY } from '~/utils/clientStorage'
import {
    applyScoreAction,
    EMPTY_SCORE,
    scoreBody,
    scoreFromRecord,
    type ScoreAction,
    type ScoreState,
} from '~/utils/scorecard'
import {
    listCompetitionScores,
    upsertCompetitionScores,
} from '~/api/competitions'
import { isNetworkError } from '~/utils/errors'
import type { CompetitionRouteRecord } from '~/types/models'

type QueueStore = Record<string, Record<string, ScoreState>>

function readStore(): QueueStore {
    try {
        return JSON.parse(localStorage.getItem(COMPETITION_SCORES_KEY) ?? '{}')
    } catch {
        return {}
    }
}

function writeStore(store: QueueStore) {
    try {
        localStorage.setItem(COMPETITION_SCORES_KEY, JSON.stringify(store))
    } catch {}
}

export function useScorecard(competitionId: Ref<string>, entryId: Ref<string>) {
    const { t } = useI18n()
    const { error: notifyError } = useNotification()

    const scores = ref<Record<string, ScoreState>>({})
    const pending = ref<Record<string, ScoreState>>({})
    const offline = ref(false)
    let flushing = false
    let edits = 0

    function persistPending() {
        const store = readStore()
        if (Object.keys(pending.value).length) {
            store[entryId.value] = pending.value
        } else {
            delete store[entryId.value]
        }
        writeStore(store)
    }

    async function fetchSaved() {
        const editsBefore = edits
        const records = await listCompetitionScores(competitionId.value, {
            entry: entryId.value,
        })
        // an edit during the request may already be saved and out of pending; its own live event reloads again
        if (edits !== editsBefore) return
        const loaded: Record<string, ScoreState> = {}
        for (const record of records) {
            loaded[record.comp_route] = scoreFromRecord(record)
        }
        scores.value = { ...loaded, ...pending.value }
    }

    async function load() {
        if (!entryId.value) return
        pending.value = readStore()[entryId.value] ?? {}
        await fetchSaved()
        await flush()
    }

    async function save(compRoute: string, score: ScoreState) {
        await upsertCompetitionScores(competitionId.value, [
            {
                entry: entryId.value,
                comp_route: compRoute,
                ...scoreBody(score),
            },
        ])
    }

    async function flush() {
        if (flushing) return
        flushing = true
        let rejected = false
        try {
            for (const [compRoute, score] of Object.entries(pending.value)) {
                try {
                    await save(compRoute, score)
                    offline.value = false
                } catch (error) {
                    if (isNetworkError(error)) {
                        offline.value = true
                        return
                    }
                    rejected = true
                    notifyError(
                        (error as { message?: string })?.message ||
                            t('competitions.scorecard.saveFailed'),
                    )
                }
                if (pending.value[compRoute] === score) {
                    const { [compRoute]: _sent, ...rest } = pending.value
                    pending.value = rest
                    persistPending()
                }
            }
        } finally {
            flushing = false
        }
        if (rejected) await fetchSaved().catch(() => {})
        if (Object.keys(pending.value).length && !offline.value) await flush()
    }

    function act(compRoute: CompetitionRouteRecord, action: ScoreAction) {
        const current = scores.value[compRoute.id] ?? EMPTY_SCORE
        const next = applyScoreAction(current, action, compRoute.zone)
        if (next === current) return
        edits++
        scores.value = { ...scores.value, [compRoute.id]: next }
        pending.value = { ...pending.value, [compRoute.id]: next }
        persistPending()
        void flush()
    }

    const pendingCount = computed(() => Object.keys(pending.value).length)

    const retry = () => void flush()
    onMounted(() => {
        useEventListener('online', retry)
        useEventListener(document, 'visibilitychange', retry)
    })

    return { scores, pendingCount, offline, load, act, flush }
}
