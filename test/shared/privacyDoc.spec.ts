import { describe, expect, it } from 'vitest'
import fixtures from '../../backend/testdata/privacyDoc.json'
import {
    DEFAULT_PRIVACY_DOC,
    hasRequiredPrivacyBlocks,
    isValidPrivacyDoc,
    missingPrivacyBlocks,
    moveTopLevelNode,
    separatePrivacyBlocks,
    privacyBlockKeyOf,
    privacyBlockNode,
    privacyDocOrDefault,
    privacyDocPayload,
    richTextFromPlain,
    type RichTextDoc,
} from '#shared/utils/privacyDoc'

describe('privacy document', () => {
    it.each(fixtures.valid.map((value) => [value]))('accepts %#', (value) => {
        expect(isValidPrivacyDoc(value)).toBe(true)
    })

    it.each(fixtures.invalid.map((value) => [value]))('rejects %#', (value) => {
        expect(isValidPrivacyDoc(value)).toBe(false)
    })

    it('keeps today’s page as the default', () => {
        expect(privacyDocOrDefault(null)).toBe(DEFAULT_PRIVACY_DOC)
        expect(privacyDocOrDefault({ type: 'doc', content: [] })).toBe(
            DEFAULT_PRIVACY_DOC,
        )
        expect(privacyBlockKeyOf(DEFAULT_PRIVACY_DOC.content[0]!)).toBe(
            'controller',
        )
        expect(privacyBlockKeyOf(DEFAULT_PRIVACY_DOC.content.at(-1)!)).toBe(
            'rights',
        )
        expect(isValidPrivacyDoc(DEFAULT_PRIVACY_DOC)).toBe(true)
        expect(missingPrivacyBlocks(DEFAULT_PRIVACY_DOC)).toEqual(['contact'])
    })

    it('stores mentions without their editor labels', () => {
        const labelled: RichTextDoc = structuredClone(DEFAULT_PRIVACY_DOC)
        for (const node of labelled.content)
            node.content![0]!.attrs = {
                ...node.content![0]!.attrs,
                label: 'Shown in the editor',
                mentionSuggestionChar: '@',
            }
        expect(privacyDocPayload(labelled)).toBeNull()

        labelled.content.splice(1, 0, ...richTextFromPlain('Own text'))
        const stored = privacyDocPayload(labelled)!
        expect(stored.content[0]).toEqual(privacyBlockNode('controller'))
        expect(stored.content[1]).toEqual({
            type: 'paragraph',
            content: [{ type: 'text', text: 'Own text' }],
        })
    })

    it('needs the controller and the rights', () => {
        const doc = structuredClone(DEFAULT_PRIVACY_DOC)
        expect(hasRequiredPrivacyBlocks(doc)).toBe(true)
        doc.content.pop()
        expect(hasRequiredPrivacyBlocks(doc)).toBe(false)
    })

    it('turns plain text into paragraphs with line breaks', () => {
        expect(richTextFromPlain('One\ntwo\n\n Three ')).toEqual([
            {
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'One' },
                    { type: 'hardBreak' },
                    { type: 'text', text: 'two' },
                ],
            },
            { type: 'paragraph', content: [{ type: 'text', text: 'Three' }] },
        ])
    })

    it('moves a top-level node up and down', () => {
        const doc: RichTextDoc = {
            type: 'doc',
            content: ['a', 'b', 'c'].map((text) => ({
                type: 'paragraph',
                text,
            })),
        }
        const order = (moved: RichTextDoc) =>
            moved.content.map((node) => node.text).join('')
        expect(order(moveTopLevelNode(doc, 2, 0))).toBe('cab')
        expect(order(moveTopLevelNode(doc, 0, 5))).toBe('bca')
        expect(moveTopLevelNode(doc, 1, 1)).toBe(doc)
        expect(moveTopLevelNode(doc, 7, 0)).toBe(doc)
        expect(order(doc)).toBe('abc')
    })

    it('moves text typed next to a section into its own paragraph', () => {
        const mention = { type: 'mention', attrs: { id: 'accounts' } }
        const text = (value: string) => ({ type: 'text', text: value })
        const doc: RichTextDoc = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [text('Before '), mention, text('after')],
                },
                privacyBlockNode('rights'),
            ],
        }
        expect(separatePrivacyBlocks(doc).content).toEqual([
            { type: 'paragraph', content: [text('Before ')] },
            { type: 'paragraph', content: [mention] },
            { type: 'paragraph', content: [text('after')] },
            privacyBlockNode('rights'),
        ])
        const clean = structuredClone(DEFAULT_PRIVACY_DOC)
        expect(separatePrivacyBlocks(clean)).toBe(clean)
    })

    it('turns a section made into a heading or list back into a section', () => {
        const mention = { type: 'mention', attrs: { id: 'controller' } }
        const doc: RichTextDoc = {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 2 }, content: [mention] },
                {
                    type: 'bulletList',
                    content: [
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [
                                        {
                                            type: 'mention',
                                            attrs: { id: 'rights' },
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'kept' }],
                                },
                            ],
                        },
                    ],
                },
            ],
        }
        const fixed = separatePrivacyBlocks(doc)
        expect(fixed.content.slice(0, 2)).toEqual([
            privacyBlockNode('controller'),
            privacyBlockNode('rights'),
        ])
        expect(JSON.stringify(fixed.content[2])).toContain('kept')
        expect(JSON.stringify(fixed.content[2])).not.toContain('mention')
    })
})
