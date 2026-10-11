import { fileToken } from '~/api/client'

const FILE_TOKEN_RENEWABLE_AFTER_MS = 60_000

export function useFileToken(
    target: () => { table: string; id: string | undefined } | null,
) {
    const token = ref('')
    let issuedAt = 0
    const key = computed(() => {
        const record = target()
        return record?.id ? `${record.table}/${record.id}` : ''
    })
    async function refresh() {
        const record = target()
        const requested = key.value
        issuedAt = Date.now()
        const next = record?.id
            ? await fileToken(record.table, record.id).catch(() => '')
            : ''
        if (key.value === requested) token.value = next
    }
    function renew() {
        if (Date.now() - issuedAt >= FILE_TOKEN_RENEWABLE_AFTER_MS)
            void refresh()
    }
    onMounted(() => watch(key, () => void refresh(), { immediate: true }))
    return { token, renew }
}
