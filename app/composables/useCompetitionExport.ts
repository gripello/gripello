import { saveBlob } from '~/utils/download'
import type { LocaleCode } from '~/utils/locales'
import type { ExportLabels } from '#shared/utils/competitionExport'

export type CompetitionExportKind = 'results' | 'startlist' | 'certificates'
export type CompetitionExportFormat = 'pdf' | 'xlsx'

const ENTRY_STATUSES = ['registered', 'checked_in', 'disqualified', 'withdrawn']

export function useCompetitionExport() {
    const authStore = useAuthStore()
    const { t, locale, loadLocaleMessages } = useI18n()
    const { pending, run } = useAsyncAction()

    function labels(kind: CompetitionExportKind, exportLocale: LocaleCode) {
        const options = { locale: exportLocale }
        const translate = (key: string, params: Record<string, string> = {}) =>
            t(key, params, options)
        const exportLabels: ExportLabels = {
            rank: translate('competitions.export.rank'),
            bib: translate('competitions.bib'),
            name: translate('competitions.export.name'),
            tops: translate('competitions.export.tops'),
            zones: translate('competitions.export.zones'),
            points: translate('competitions.points'),
            category: translate('competitions.register.category'),
            birthYear: translate('competitions.register.birthYear'),
            status: translate('competitions.export.status'),
            paid: translate('competitions.paid'),
            yes: translate('competitions.export.yes'),
            no: translate('competitions.export.no'),
            anonymous: translate('competitions.standings.anonymous'),
            statuses: Object.fromEntries(
                ENTRY_STATUSES.map((status) => [
                    status,
                    translate(`competitions.entryStatuses.${status}`),
                ]),
            ),
        }
        return {
            ...exportLabels,
            title: translate(`competitions.export.kinds.${kind}`),
            certificate: translate('competitions.export.certificate'),
            place: translate('competitions.export.place', {
                rank: '{rank}',
                category: '{category}',
            }),
        }
    }

    async function download(
        competition: { id: string; name: string },
        kind: CompetitionExportKind,
        format: CompetitionExportFormat,
        exportLocale: LocaleCode = locale.value as LocaleCode,
    ) {
        return run(async () => {
            await loadLocaleMessages(exportLocale)
            const exportLabels = labels(kind, exportLocale)
            const response = await fetch('/api/ui/competition-export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authStore.token
                        ? { Authorization: authStore.token }
                        : {}),
                },
                body: JSON.stringify({
                    id: competition.id,
                    kind,
                    format,
                    locale: exportLocale,
                    labels: exportLabels,
                }),
            })
            if (!response.ok)
                throw new Error(`Export failed: ${response.status}`)
            saveBlob(
                await response.blob(),
                `${competition.name}-${exportLabels.title}.${format}`,
            )
            return true
        })
    }

    return { pending, download }
}
