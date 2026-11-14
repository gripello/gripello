import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const appDir = path.resolve(import.meta.dirname, '../../app')

describe('window and document listeners in components', () => {
    it('go through useEventListener so they end with the component', () => {
        const raw = ['components', 'pages']
            .flatMap((dir) =>
                readdirSync(path.join(appDir, dir), {
                    recursive: true,
                    encoding: 'utf8',
                }).map((file) => path.join(dir, file)),
            )
            .filter((file) => file.endsWith('.vue'))
            .filter((file) =>
                /\b(window|document)\.addEventListener\(/.test(
                    readFileSync(path.join(appDir, file), 'utf8'),
                ),
            )
        expect(raw).toEqual([])
    })
})
