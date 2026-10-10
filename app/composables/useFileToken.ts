import { fileToken } from '~/api/client'

const FILE_TOKEN_REFRESH_MS = 100_000

export function useFileToken(
    target: () => { table: string; id: string | undefined } | null,
) {
    const token = ref('')
    const key = computed(() => {
        const record = target()
        return record?.id ? `${record.table}/${record.id}` : ''
    })
    async function refresh() {
        const record = target()
        const requested = key.value
        const next = record?.id
            ? await fileToken(record.table, record.id).catch(() => '')
            : ''
        if (key.value === requested) token.value = next
    }
    let timer: ReturnType<typeof setInterval> | undefined
    onMounted(() => {
        watch(key, () => void refresh(), { immediate: true })
        timer = setInterval(() => void refresh(), FILE_TOKEN_REFRESH_MS)
    })
    onBeforeUnmount(() => clearInterval(timer))
    return token
}
