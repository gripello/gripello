import { describe, expect, it } from 'vitest'
import {
    inlineText,
    privacySections,
    richTextBlocks,
} from '~/utils/legalRichText'
import { privacyBlockNode } from '#shared/utils/privacyDoc'

const text = (value: string, marks?: object[]) => ({
    type: 'text',
    text: value,
    ...(marks && { marks }),
})

describe('legal rich text', () => {
    it('maps headings, paragraphs, lists and marks', () => {
        const blocks = richTextBlocks({
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [text('Cams')],
                },
                {
                    type: 'heading',
                    attrs: { level: 5 },
                    content: [text('Small')],
                },
                {
                    type: 'paragraph',
                    content: [
                        text('We '),
                        text('film', [{ type: 'bold' }, { type: 'italic' }]),
                        { type: 'hardBreak' },
                        text('daily'),
                    ],
                },
                {
                    type: 'orderedList',
                    content: [
                        {
                            type: 'listItem',
                            content: [
                                { type: 'paragraph', content: [text('a')] },
                                {
                                    type: 'bulletList',
                                    content: [
                                        {
                                            type: 'listItem',
                                            content: [
                                                {
                                                    type: 'paragraph',
                                                    content: [text('b')],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                { type: 'paragraph' },
            ],
        })
        expect(blocks).toEqual([
            { type: 'h3', children: [{ type: 'text', text: 'Cams' }] },
            { type: 'h4', children: [{ type: 'text', text: 'Small' }] },
            {
                type: 'p',
                children: [
                    { type: 'text', text: 'We ' },
                    {
                        type: 'strong',
                        children: [
                            {
                                type: 'em',
                                children: [{ type: 'text', text: 'film' }],
                            },
                        ],
                    },
                    { type: 'br' },
                    { type: 'text', text: 'daily' },
                ],
            },
            {
                type: 'ol',
                items: [
                    [
                        { type: 'p', children: [{ type: 'text', text: 'a' }] },
                        {
                            type: 'ul',
                            items: [
                                [
                                    {
                                        type: 'p',
                                        children: [{ type: 'text', text: 'b' }],
                                    },
                                ],
                            ],
                        },
                    ],
                ],
            },
        ])
    })

    it('keeps only safe links', () => {
        const link = (href: string) =>
            richTextBlocks({
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            text('x', [{ type: 'link', attrs: { href } }]),
                        ],
                    },
                ],
            })[0]
        expect(link('https://example.com')).toEqual({
            type: 'p',
            children: [
                {
                    type: 'link',
                    href: 'https://example.com',
                    children: [{ type: 'text', text: 'x' }],
                },
            ],
        })
        expect(link('mailto:a@b.c')).toMatchObject({
            children: [{ type: 'link' }],
        })
        for (const unsafe of [
            'javascript:alert(1)',
            '//evil.test',
            '/\\evil.test',
            'data:x',
        ])
            expect(link(unsafe)).toEqual({
                type: 'p',
                children: [{ type: 'text', text: 'x' }],
            })
    })

    it('fills placeholders, blanks empty ones and leaves unknown ones', () => {
        const [block] = richTextBlocks(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            text(
                                '{gym} keeps logs {auditDays} days {phone} {nope}',
                            ),
                        ],
                    },
                ],
            },
            { gym: 'Halle', auditDays: 90, phone: '' },
        )
        expect(block).toEqual({
            type: 'p',
            children: [
                {
                    type: 'text',
                    text: 'Halle keeps logs 90 days  {nope}',
                },
            ],
        })
    })

    it('renders nothing for unknown nodes without text', () => {
        expect(
            richTextBlocks({
                type: 'doc',
                content: [{ type: 'image', attrs: { src: 'x.png' } }],
            }),
        ).toEqual([])
    })

    it('splits the page into built-in sections and own text', () => {
        const sections = privacySections(
            {
                type: 'doc',
                content: [
                    privacyBlockNode('controller'),
                    {
                        type: 'paragraph',
                        content: [text('Intro without a title')],
                    },
                    {
                        type: 'heading',
                        attrs: { level: 2 },
                        content: [text('Cameras')],
                    },
                    {
                        type: 'paragraph',
                        content: [
                            text('See '),
                            { type: 'mention', attrs: { id: 'rights' } },
                        ],
                    },
                    privacyBlockNode('rights'),
                    privacyBlockNode('nope' as never),
                ],
            },
            {},
            (id) => `title:${id}`,
        )
        expect(sections).toEqual([
            { type: 'block', key: 'controller' },
            {
                type: 'text',
                title: [],
                blocks: [
                    {
                        type: 'p',
                        children: [
                            { type: 'text', text: 'Intro without a title' },
                        ],
                    },
                ],
            },
            {
                type: 'text',
                title: [{ type: 'text', text: 'Cameras' }],
                blocks: [
                    {
                        type: 'p',
                        children: [
                            { type: 'text', text: 'See ' },
                            { type: 'text', text: 'title:rights' },
                        ],
                    },
                ],
            },
            { type: 'block', key: 'rights' },
        ])
    })
})

describe('inlineText', () => {
    it('flattens marks and links into plain text', () => {
        expect(
            inlineText([
                { type: 'text', text: 'Your ' },
                {
                    type: 'strong',
                    children: [{ type: 'text', text: 'rights' }],
                },
                { type: 'br' },
                {
                    type: 'link',
                    href: '/x',
                    children: [{ type: 'text', text: 'here' }],
                },
            ]),
        ).toBe('Your rights here')
    })
})
