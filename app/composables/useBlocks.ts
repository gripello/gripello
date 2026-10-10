import { createBlock, deleteBlock, listBlocks } from '~/api/social'
import { cacheKeys } from '~/utils/realtimeCache'
import { serverDedupe } from '~/utils/asyncData'

export function useBlocks() {
    const authRecord = useAuthRecord()
    const myId = computed(() => authRecord.value?.id ?? '')
    const request = useAsyncData(
        cacheKeys.blocks,
        () => (myId.value ? listBlocks() : Promise.resolve([])),
        { ...serverDedupe, default: () => [], watch: [myId] },
    )
    const blockedIds = computed(
        () => new Set(request.data.value.map((block) => block.blocked)),
    )

    async function block(userId: string) {
        await createBlock(userId)
        await Promise.all([
            request.refresh(),
            refreshNuxtData(cacheKeys.follows),
        ])
    }

    async function unblock(userId: string) {
        const existing = request.data.value.find(
            (entry) => entry.blocked === userId,
        )
        if (existing) await deleteBlock(existing.id)
        await request.refresh()
    }

    return {
        blocks: request.data,
        blockedIds,
        isBlocked: (userId?: string | null) =>
            !!userId && blockedIds.value.has(userId),
        block,
        unblock,
    }
}
