import type { CapScope } from '~~/server/utils/cap'

interface CapStatus {
    enabled: boolean
}

export function useCapStatus() {
    return useAsyncData<CapStatus>(
        'cap-status',
        async () => {
            try {
                return await $fetch<CapStatus>('/api/cap/status')
            } catch (err) {
                return { enabled: false }
            }
        },
        { default: () => ({ enabled: false }) },
    )
}

export function useCapToken() {
    const { data: status } = useCapStatus()

    const solving = useState('cap-solving', () => false)
    const progress = useState('cap-progress', () => 0)

    async function capHeaders(
        scope: CapScope,
    ): Promise<Record<string, string>> {
        if (!status.value?.enabled || import.meta.server) return {}

        solving.value = true
        progress.value = 0
        try {
            const [{ default: capWasmUrl }, { default: pakoUrl }] =
                await Promise.all([
                    import('@cap.js/wasm/browser/cap_wasm_bg.wasm?url'),
                    import('../../node_modules/pako/dist/browser/pako_inflate.umd.min.js?url'),
                ])
            const w = globalThis as any
            w.CAP_CUSTOM_WASM_URL = capWasmUrl
            w.CAP_PAKO_URL = pakoUrl

            await import('cap-widget')
            const Cap = w.Cap
            if (!Cap) throw new Error('cap-widget did not register')

            const cap = new Cap({ apiEndpoint: `/api/cap/${scope}/` })
            cap.addEventListener('progress', (event: any) => {
                progress.value = Math.round(event?.detail?.progress ?? 0)
            })
            const { token } = await cap.solve()
            return { 'X-Cap-Token': token }
        } finally {
            solving.value = false
        }
    }

    return { capHeaders, solving, progress }
}
