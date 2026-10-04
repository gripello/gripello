import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface PackageJson {
    name: string
    version: string
    license?: string | { type: string }
}

const NOTICE_FILE = /^(licen[cs]e|copying|notice)/i

function readPackage(dir: string): PackageJson | null {
    try {
        return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
        return null
    }
}

export function installedPackageDirs(
    nodeModulesDir: string,
): Map<string, string> {
    const dirs = new Map<string, string>()
    const walk = (dir: string) => {
        if (!existsSync(dir)) {
            return
        }
        for (const entry of readdirSync(dir)) {
            if (entry.startsWith('.')) {
                continue
            }
            const path = join(dir, entry)
            if (entry.startsWith('@')) {
                walk(path)
                continue
            }
            const pkg = readPackage(path)
            if (pkg?.name && pkg.version) {
                dirs.set(`${pkg.name}@${pkg.version}`, path)
            }
            walk(join(path, 'node_modules'))
        }
    }
    walk(nodeModulesDir)
    return new Map([...dirs].sort(([a], [b]) => a.localeCompare(b)))
}

function licenseName(pkg: PackageJson): string {
    if (typeof pkg.license === 'object') {
        return pkg.license.type
    }
    return pkg.license ?? 'UNKNOWN'
}

function noticeTexts(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && NOTICE_FILE.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .map((file) => readFileSync(join(dir, file), 'utf8').trim())
}

export function thirdPartyNotices(nodeModulesDir: string): string {
    const sections = [...installedPackageDirs(nodeModulesDir)].map(
        ([id, dir]) => {
            const texts = noticeTexts(dir)
            return [
                `${id} (${licenseName(readPackage(dir)!)})`,
                texts.length
                    ? texts.join('\n\n')
                    : 'No license file shipped with the package.',
            ].join('\n\n')
        },
    )
    return `${sections.join(`\n\n${'-'.repeat(78)}\n\n`)}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.stdout.write(thirdPartyNotices(process.argv[2] ?? 'node_modules'))
}
