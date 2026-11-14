import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const pagesDir = path.resolve(import.meta.dirname, '../../app/pages')
const pages = readdirSync(pagesDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.vue'))
    .map((file) => ({
        file,
        source: readFileSync(path.join(pagesDir, file), 'utf8'),
    }))

describe('page SEO meta', () => {
    it('gives every page with an Open Graph title an Open Graph description', () => {
        const missing = pages
            .filter(
                ({ source }) =>
                    /\bogTitle:/.test(source) &&
                    !/\bogDescription:/.test(source),
            )
            .map(({ file }) => file)
        expect(missing).toEqual([])
    })
})
