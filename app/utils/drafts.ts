export function syncDrafts(
    drafts: Record<string, string>,
    synced: Record<string, string>,
    records: { id: string; name: string }[],
) {
    for (const { id, name } of records) {
        if (drafts[id] === undefined || drafts[id] === synced[id])
            drafts[id] = name
        synced[id] = name
    }
}
