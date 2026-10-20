export const UNPREFETCHED_IMPORTS =
    /maplibre-gl|@cj-tech-master\/excelts|echartsCore|cap-widget|@cap\.js|pako|zxing-wasm|PrivacyEditor/

export function skipHeavyPrefetches(
    manifest: Record<string, { dynamicImports?: string[] }>,
) {
    for (const chunk of Object.values(manifest))
        chunk.dynamicImports &&= chunk.dynamicImports.filter(
            (id) => !UNPREFETCHED_IMPORTS.test(id),
        )
}
