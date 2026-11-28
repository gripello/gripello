import { readFileSync } from 'node:fs'

const source = readFileSync('app/pages/[gym]/manage/routes.vue', 'utf8')
const template = source.slice(0, source.indexOf('<script'))

describe('manage routes actions', () => {
    it('keeps create route as the only primary action', () => {
        expect(template.match(/color="primary"/g)).toHaveLength(2)
        expect(
            template.match(/data-testid="routes-create-open"/g),
        ).toHaveLength(2)
        expect(template).not.toContain('color="success"')
        expect(template).not.toMatch(/color="primary"\s+variant="soft"/)
    })

    it('groups the exports in one menu', () => {
        expect(template).toContain('data-testid="routes-export"')
        expect(template).toContain(':items="exportItems"')
        for (const format of ['pdf', 'xlsx', 'json'])
            expect(source).toContain(`'data-testid': 'routes-export-${format}'`)
    })
})

describe('manage routes saved toast', () => {
    it('says the route was archived when the form archived it', () => {
        const source = readFileSync('app/pages/[gym]/manage/routes.vue', 'utf8')
        expect(source).toContain('@archived="onRouteArchived"')
        expect(source).toMatch(
            /onRouteArchived = async \(\) => \{\s*notify\(t\('notifications\.success\.archived'\)\)/,
        )
    })
})
