import { describe, expect, it } from 'vitest'
import { Workbook } from '@cj-tech-master/excelts'
import {
    ROUTE_IMPORT_FIELDS,
    REVIEW_IMPORT_FIELDS,
    guessImportMapping,
    matchReviewRoute,
    parseImportDate,
    parseImportDateTime,
    parseImportRating,
    toImportedReview,
    topLoggerGrade,
    tableFromCsv,
    tableFromJson,
    tableFromXlsx,
    toImportedRoute,
} from '~/utils/routeImport'

const context = {
    typeByLabel: new Map([
        ['route', 'Route'],
        ['boulder', 'Boulder'],
        ['seil', 'Route'],
    ]),
    gradeSystemFor: (type: string | null | undefined) =>
        type === 'Boulder' ? 'font' : 'uiaa',
    locale: 'de',
}

describe('guessImportMapping', () => {
    it('matches field keys, export headers and translated labels', () => {
        expect(
            guessImportMapping(
                ROUTE_IMPORT_FIELDS,
                ['Name', 'Grade', 'Set on', 'Setters', 'Typ', 'Wand', 'x'],
                { type: 'Typ', wall: 'Wand' },
            ),
        ).toEqual({
            name: 'Name',
            grade: 'Grade',
            screw_date: 'Set on',
            creator: 'Setters',
            type: 'Typ',
            wall: 'Wand',
        })
    })
})

describe('tableFromCsv', () => {
    it('detects the delimiter and keeps quoted values', async () => {
        expect(await tableFromCsv('﻿Name;Grade\n"A; B";6a\n\nC\n')).toEqual({
            headers: ['Name', 'Grade'],
            rows: [
                { Name: 'A; B', Grade: '6a' },
                { Name: 'C', Grade: '' },
            ],
        })
    })
})

describe('tableFromJson', () => {
    it('lists keys as columns but keeps ratings and legacy grades out', () => {
        const table = tableFromJson([
            { name: 'A', difficulty: 6, ratings: [] },
            { name: 'B', comment: 'x' },
        ])
        expect(table.headers).toEqual(['name', 'comment'])
        expect(() => tableFromJson({ name: 'A' })).toThrow()
    })
})

describe('tableFromXlsx', () => {
    it('reads the export layout including the colour fill', async () => {
        const workbook = new Workbook()
        const sheet = workbook.addWorksheet('Routes')
        sheet.addRow(['Color', 'Name', 'Set on'])
        const row = sheet.addRow([null, 'Crimp', new Date('2026-03-04')])
        row.getCell(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2196F3' },
        }
        const buffer = await workbook.xlsx.writeBuffer()

        expect(await tableFromXlsx(buffer as ArrayBuffer)).toEqual({
            headers: ['Color', 'Name', 'Set on'],
            rows: [
                {
                    Color: '#2196F3',
                    Name: 'Crimp',
                    'Set on': '2026-03-04T00:00:00.000Z',
                },
            ],
        })
    })
})

describe('toImportedRoute', () => {
    it('maps columns, translates the type and picks its grade system', () => {
        expect(
            toImportedRoute(
                {
                    Route: ' Crimp ',
                    Diff: '6A',
                    Kind: 'Boulder',
                    Anchor: '3,5',
                    Colour: '2196f3',
                    Setters: 'Mia, Ben',
                    Date: '4.3.2026',
                    Old: 'x',
                },
                {
                    name: 'Route',
                    grade: 'Diff',
                    type: 'Kind',
                    anchor_point: 'Anchor',
                    color: 'Colour',
                    creator: 'Setters',
                    screw_date: 'Date',
                    archived: 'Old',
                },
                context,
            ),
        ).toMatchObject({
            name: 'Crimp',
            grade: '6A',
            grade_system: 'font',
            type: 'Boulder',
            anchor_point: '3.5',
            color: '#2196F3',
            creator: 'Mia, Ben',
            screw_date: '2026-03-04',
            archived: true,
            comment: '',
        })
    })

    it('keeps legacy grades and ratings of Gripello JSON exports', () => {
        const ratings = [{ rating: 5 }]
        const route = toImportedRoute(
            { name: 'A', type: 'seil', difficulty: 7, ratings },
            { name: 'name', type: 'type' },
            context,
        )
        expect(route).toMatchObject({
            type: 'Route',
            difficulty: 7,
            ratings,
            grade_system: undefined,
            anchor_point: undefined,
        })
    })
})

describe('parseImportDate', () => {
    it.each([
        ['2026-03-04T10:00:00Z', 'de', '2026-03-04'],
        ['4.3.2026', 'de', '2026-03-04'],
        ['04/03/2026', 'fr', '2026-03-04'],
        ['3/4/2026', 'en', '2026-03-04'],
        ['13/13/2026', 'en', null],
        ['', 'en', null],
    ])('%s (%s) → %s', (value, locale, expected) => {
        expect(parseImportDate(value, locale)).toBe(expected)
    })
})

describe('review import', () => {
    it('guesses review columns without reusing a header', () => {
        expect(
            guessImportMapping(REVIEW_IMPORT_FIELDS, [
                'Route ID',
                'Route',
                'Stars',
                'Text',
                'Date',
            ]),
        ).toEqual({
            route: 'Route ID',
            route_name: 'Route',
            rating: 'Stars',
            comment: 'Text',
            created: 'Date',
        })
    })

    it('reads a review row', () => {
        expect(
            toImportedReview(
                { R: '17', S: '4/5', G: '6a', D: '2021-03-04T09:30:00Z' },
                { route: 'R', rating: 'S', grade: 'G', created: 'D' },
                'de',
            ),
        ).toEqual({
            routeKey: '17',
            routeName: '',
            location: '',
            rating: 4,
            grade: '6a',
            grade_system: undefined,
            comment: '',
            created: '2021-03-04T09:30:00.000Z',
        })
    })

    it.each([
        ['4', 4],
        ['4,5', 4.5],
        ['3/5', 3],
        ['9', 5],
        ['8/10', 4],
        ['3 / 6', 2.5],
        ['0/5', 1],
        ['', null],
        ['great', null],
        [undefined, null],
    ])('rating %s → %s', (value, expected) => {
        expect(parseImportRating(value)).toBe(expected)
    })

    it('keeps the time of a review date', () => {
        expect(parseImportDateTime('4.3.2021 14:05', 'de')).toBe(
            new Date(2021, 2, 4, 14, 5).toISOString(),
        )
        expect(parseImportDateTime('2021-03-04', 'de')).toBe(
            new Date(2021, 2, 4).toISOString(),
        )
        expect(
            parseImportDateTime(new Date('2021-03-04T10:00:00Z'), 'de'),
        ).toBe('2021-03-04T10:00:00.000Z')
        expect(parseImportDateTime('soon', 'de')).toBeNull()
    })

    const routes = [
        {
            id: 'old',
            name: 'Crimp',
            location: 'Hall',
            date: '2020-01-01 00:00:00.000Z',
        },
        {
            id: 'new',
            name: 'Crimp',
            location: 'Hall',
            date: '2022-01-01 00:00:00.000Z',
        },
        {
            id: 'cave',
            name: 'Crimp',
            location: 'Cave',
            date: '2019-01-01 00:00:00.000Z',
        },
        { id: 'abc123', name: 'Sloper', location: 'Hall', date: '2021-01-01' },
    ]
    const review = (
        overrides: Partial<Parameters<typeof matchReviewRoute>[0]>,
    ) => ({
        routeKey: '',
        routeName: '',
        location: '',
        created: null,
        ...overrides,
    })

    it('matches an imported source id, then a Gripello id', () => {
        const sourceIds = new Map([['17', 'abc123']])
        expect(
            matchReviewRoute(review({ routeKey: '17' }), routes, sourceIds),
        ).toBe('abc123')
        expect(
            matchReviewRoute(review({ routeKey: 'abc123' }), routes, new Map()),
        ).toBe('abc123')
    })

    it('matches by name, location and the route set before the review', () => {
        const match = (
            overrides: Partial<Parameters<typeof matchReviewRoute>[0]>,
        ) => matchReviewRoute(review(overrides), routes, new Map())
        expect(match({ routeName: 'crimp' })).toBe('new')
        expect(
            match({
                routeName: 'Crimp',
                created: new Date(2022, 0, 1, 0, 30).toISOString(),
            }),
        ).toBe('new')
        expect(
            match({ routeName: 'Crimp', created: '2021-06-01T10:00:00.000Z' }),
        ).toBe('old')
        expect(match({ routeName: 'Crimp', location: 'cave' })).toBe('cave')
        expect(
            match({
                routeKey: '17',
                routeName: 'Crimp',
                created: '2010-01-01T00:00:00.000Z',
            }),
        ).toBe('new')
        expect(match({ routeKey: '17' })).toBeNull()
    })
})

describe('TopLogger exports', () => {
    const graphQlResponse = {
        data: {
            climbs: {
                data: [
                    {
                        id: '901',
                        name: 'Pinch party',
                        grade: '6.33',
                        climbType: 'boulder',
                        outAt: null,
                        holdColor: { color: '#2196f3' },
                        wall: { id: '4', nameLoc: 'Cave' },
                    },
                ],
            },
        },
    }

    it('unwraps API responses and flattens nested objects', () => {
        expect(tableFromJson(graphQlResponse)).toEqual({
            headers: [
                'id',
                'name',
                'grade',
                'climbType',
                'outAt',
                'holdColor.color',
                'wall.id',
                'wall.nameLoc',
            ],
            rows: [
                {
                    id: '901',
                    name: 'Pinch party',
                    grade: '6.33',
                    climbType: 'boulder',
                    outAt: null,
                    'holdColor.color': '#2196f3',
                    'wall.id': '4',
                    'wall.nameLoc': 'Cave',
                },
            ],
        })
        expect(
            tableFromJson([{ name: 'A', ratings: [{ rating: 4 }] }]).rows[0]
                ?.ratings,
        ).toEqual([{ rating: 4 }])
    })

    it('maps GraphQL and v1 fields without help', () => {
        const { headers } = tableFromJson(graphQlResponse)
        expect(guessImportMapping(ROUTE_IMPORT_FIELDS, headers)).toEqual({
            source_id: 'id',
            name: 'name',
            grade: 'grade',
            type: 'climbType',
            wall: 'wall.nameLoc',
            color: 'holdColor.color',
        })
        expect(
            guessImportMapping(ROUTE_IMPORT_FIELDS, [
                'climb_type',
                'date_set',
                'remarks',
                'setter_id',
            ]),
        ).toEqual({
            type: 'climb_type',
            screw_date: 'date_set',
        })
        expect(
            guessImportMapping(REVIEW_IMPORT_FIELDS, ['climb_id', 'value']),
        ).toEqual({ route: 'climb_id' })
    })

    it.each([
        ['6.0', '6a'],
        ['6.17', '6a+'],
        ['6.33', '6b'],
        ['6.5', '6b+'],
        ['6.67', '6c'],
        ['6.83', '6c+'],
        ['7.33', '7b'],
        ['4.0', '4'],
        ['4.33', '4+'],
        ['4.67', '5'],
        ['5.5', '5+'],
        ['5.83', '6a'],
        ['6+', null],
        ['6', null],
    ])('grade %s → %s', (value, expected) => {
        expect(topLoggerGrade(value)).toBe(expected)
    })

    it('leaves grades that are valid in the target system alone', () => {
        expect(
            toImportedRoute(
                { g: '5.9', s: 'yds' },
                { grade: 'g', grade_system: 's' },
                context,
            ),
        ).toMatchObject({ grade: '5.9', grade_system: 'yds' })
        expect(
            toImportedRoute(
                { g: '5.9' },
                { grade: 'g' },
                { ...context, gradeSystemFor: () => 'yds' },
            ),
        ).toMatchObject({ grade: '5.9', grade_system: 'yds' })
    })

    it('imports a TopLogger boulder with a Font grade', () => {
        const { headers, rows } = tableFromJson(graphQlResponse)
        expect(
            toImportedRoute(
                rows[0]!,
                guessImportMapping(ROUTE_IMPORT_FIELDS, headers),
                context,
            ),
        ).toMatchObject({
            source_id: '901',
            name: 'Pinch party',
            grade: '6b',
            grade_system: 'font',
            type: 'Boulder',
            wall: 'Cave',
            color: '#2196F3',
        })
    })
})
