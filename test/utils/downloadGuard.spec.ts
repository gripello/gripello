import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')
const DOWNLOAD_HELPER = 'app/utils/download.ts'
// Backups and data exports are gigabytes: they stream through the browser or Android's DownloadManager instead of memory.
const URL_DOWNLOADS = new Set([
    'app/pages/platform/backups.vue',
    'app/pages/account/export/[token].vue',
])

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sourceFiles(path)
        return /\.(vue|ts)$/.test(name) ? [path] : []
    })
}

const files = sourceFiles(join(ROOT, 'app')).map((path) => ({
    path: relative(ROOT, path),
    text: readFileSync(path, 'utf8'),
}))

const template = (text: string) =>
    text.match(/<template>[\s\S]*<\/template>/)?.[0] ?? ''

function offenders(test: (file: { path: string; text: string }) => boolean) {
    return files
        .filter((file) => file.path !== DOWNLOAD_HELPER)
        .filter((file) => !URL_DOWNLOADS.has(file.path))
        .filter(test)
        .map((file) => file.path)
}

describe('downloads go through saveBlob / saveDownload', () => {
    it('no link builds its own blob download', () => {
        expect(offenders((file) => /\.download\s*=/.test(file.text))).toEqual(
            [],
        )
    })

    it('no template link downloads straight from a URL', () => {
        expect(
            offenders((file) =>
                /\sdownload(?=[\s/>=])/.test(template(file.text)),
            ),
        ).toEqual([])
    })

    it('no template link points at an API file endpoint', () => {
        expect(
            offenders((file) =>
                /(?:href|to)="[^"]*\/api\/(?:ui|platform\/backups)\//.test(
                    template(file.text),
                ),
            ),
        ).toEqual([])
    })

    it('the URL-download allowlist only names files that still exist', () => {
        for (const path of URL_DOWNLOADS)
            expect(files.some((file) => file.path === path)).toBe(true)
    })
})
