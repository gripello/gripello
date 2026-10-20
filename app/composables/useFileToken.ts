import { issueFileToken } from '~/api/client'

const FILE_TOKEN_RENEWABLE_AFTER_MS = 60_000
const FILE_TOKEN_RETRY_MS = 2_000
const FILE_TOKEN_RETRIES = 5

export function useFileToken(
    target: () => { table: string; id: string | undefined } | null,
) {
    const token = ref('')
    let tokenKey = ''
    let issuedAt = 0
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let unmounted = false
    const key = computed(() => {
        const record = target()
        return record?.id ? `${record.table}/${record.id}` : ''
    })
    async function refresh() {
        clearTimeout(retryTimer)
        const record = target()
        const requested = key.value
        issuedAt = Date.now()
        let failed = false
        const next = record?.id
            ? await issueFileToken(record.table, record.id).catch(() => {
                  failed = true
                  return ''
              })
            : ''
        if (key.value !== requested) return
        if (!failed) {
            retries = 0
            tokenKey = requested
            token.value = next
            return
        }
        // without a token no <img> renders, so no @error would ever renew it
        if (tokenKey !== requested) token.value = ''
        if (unmounted || retries >= FILE_TOKEN_RETRIES) return
        retryTimer = setTimeout(
            () => void refresh(),
            FILE_TOKEN_RETRY_MS * 2 ** retries++,
        )
    }
    function renew() {
        if (Date.now() - issuedAt >= FILE_TOKEN_RENEWABLE_AFTER_MS)
            void refresh()
    }
    onMounted(() =>
        watch(
            key,
            () => {
                retries = 0
                void refresh()
            },
            { immediate: true },
        ),
    )
    onBeforeUnmount(() => {
        unmounted = true
        clearTimeout(retryTimer)
    })
    return { token, renew }
}
