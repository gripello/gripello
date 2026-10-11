import type { ExportOptions } from '~/components/ExportOptionsDialog.vue'
import { ROUTE_TYPES } from '~/utils/routes'
import { saveBlob } from '~/utils/download'

type ExportFormat = 'pdf' | 'xlsx' | 'json'

const MIME_TYPES: Record<ExportFormat, string> = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    json: 'application/json',
}

function exportTimestamp(date = new Date()) {
    const pad = (value: number) => value.toString().padStart(2, '0')
    return `${pad(date.getHours())}-${pad(date.getMinutes())}_${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}

async function responseToBlob(response: Response, format: ExportFormat) {
    if (format === 'json') {
        const text = JSON.stringify(await response.json(), null, 2)
        return new Blob([text], { type: MIME_TYPES.json })
    }
    return new Blob([await response.blob()], { type: MIME_TYPES[format] })
}

export function useRouteExport() {
    const authStore = useAuthStore()
    const gymId = useCurrentGymId()
    const { t, locale } = useI18n()
    const { error: notifyError } = useNotification()

    const exportingFormat = ref<ExportFormat | null>(null)

    const downloadExport = async (
        format: ExportFormat,
        ids: string[],
        payload: Record<string, unknown> = {},
    ) => {
        if (!ids.length || exportingFormat.value) return

        exportingFormat.value = format
        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            }
            if (authStore.token) headers.Authorization = authStore.token

            const response = await fetch(`/api/ui/${format}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ids,
                    gym: gymId.value,
                    locale: locale.value,
                    typeLabels: Object.fromEntries(
                        ROUTE_TYPES.map((type) => [
                            type,
                            t(`routes.types.${type.toLowerCase()}`),
                        ]),
                    ),
                    ...payload,
                }),
            })
            if (!response.ok) {
                throw new Error(`Export failed with status ${response.status}`)
            }

            saveBlob(
                await responseToBlob(response, format),
                `${t('export.fileName')}-${exportTimestamp()}.${format}`,
            )
        } catch (error) {
            console.error(`Export error (${format}):`, error)
            notifyError(t('notifications.error.generic'))
        } finally {
            exportingFormat.value = null
        }
    }

    return {
        exportingFormat,
        exportPdf: (ids: string[], options: ExportOptions) =>
            downloadExport('pdf', ids, { ...options }),
        exportXlsx: (ids: string[], options: ExportOptions) =>
            downloadExport('xlsx', ids, { ...options }),
        exportJson: (ids: string[]) => downloadExport('json', ids),
    }
}
