import { versionLabel } from '#shared/utils/version'
import { sharedAsyncData } from '~/utils/asyncData'

export interface VersionCommit {
    sha: string
    message: string
    date: string | null
}

export interface VersionPayload {
    installed: {
        raw: string
        base: string | null
        ahead: number
        sha: string | null
        notes: string | null
        publishedAt: string | null
    }
    latest: {
        tag: string
        notes: string | null
        publishedAt: string | null
    } | null
    commits: VersionCommit[]
    installedCommits: VersionCommit[]
    mode: 'release' | 'commit' | 'none'
    updateAvailable: boolean
    error: 'rate_limited' | 'unavailable' | null
}

export function useVersionCheck() {
    const { data, status, refresh } = useAsyncData<VersionPayload>(
        'version',
        () => $fetch<VersionPayload, string>('/api/version'),
        { ...sharedAsyncData, dedupe: 'defer', server: false, lazy: true },
    )

    const { appVersion, repoUrl } = useRuntimeConfig().public as {
        appVersion: string
        repoUrl: string
    }
    const appVersionLabel = versionLabel(appVersion, import.meta.dev)
    const installedPublishedAt = computed(
        () => data.value?.installed.publishedAt ?? null,
    )
    const installedCommits = computed<VersionCommit[]>(
        () => data.value?.installedCommits ?? [],
    )
    const mode = computed(() => data.value?.mode ?? 'none')
    const updateAvailable = computed(() => data.value?.updateAvailable ?? false)
    const latest = computed(() => data.value?.latest ?? null)
    const installedNotes = computed(() => data.value?.installed.notes ?? null)
    const installedBase = computed(() => data.value?.installed.base ?? null)

    const error = computed(() => data.value?.error ?? null)

    const loading = computed(
        () => status.value === 'idle' || status.value === 'pending',
    )
    const commits = computed<VersionCommit[]>(() => data.value?.commits ?? [])

    const updateId = computed(() =>
        mode.value === 'release'
            ? (latest.value?.tag ?? '')
            : (commits.value[0]?.sha ?? ''),
    )

    return {
        appVersion,
        appVersionLabel,
        installedPublishedAt,
        installedCommits,
        repoUrl,
        mode,
        updateAvailable,
        latest,
        installedNotes,
        installedBase,
        error,
        loading,
        commits,
        updateId,
        refresh,
    }
}
