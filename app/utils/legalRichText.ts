import {
    PRIVACY_BLOCK_MENTION,
    isPrivacyBlockKey,
    privacyBlockKeyOf,
    type PrivacyBlockKey,
    type RichTextDoc,
    type RichTextNode,
} from '#shared/utils/privacyDoc'

export type RichInline =
    | { type: 'text'; text: string }
    | { type: 'strong' | 'em' | 's' | 'code'; children: RichInline[] }
    | { type: 'link'; href: string; children: RichInline[] }
    | { type: 'br' }

export type RichBlock =
    | { type: 'p' | 'h3' | 'h4'; children: RichInline[] }
    | { type: 'ul' | 'ol'; items: RichBlock[][] }

export type RichTextVars = Record<string, string | number | null | undefined>
export type MentionLabel = (id: string) => string

const ownId: MentionLabel = (id) => id

const SAFE_HREF = /^(https?:|mailto:|tel:|\/(?![/\\]))/i
const MARK_TAGS: Record<string, 'strong' | 'em' | 's' | 'code'> = {
    bold: 'strong',
    italic: 'em',
    strike: 's',
    code: 'code',
}

function fill(text: string, vars: RichTextVars) {
    return text.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name] ?? '') : match,
    )
}

function textNode(node: RichTextNode, vars: RichTextVars): RichInline {
    let inline: RichInline = { type: 'text', text: fill(node.text ?? '', vars) }
    for (const mark of [...(node.marks ?? [])].reverse()) {
        const href = String(mark.attrs?.href ?? '')
        if (mark.type === 'link' && SAFE_HREF.test(href))
            inline = { type: 'link', href, children: [inline] }
        else if (MARK_TAGS[mark.type])
            inline = { type: MARK_TAGS[mark.type]!, children: [inline] }
    }
    return inline
}

function inlines(
    nodes: RichTextNode[] = [],
    vars: RichTextVars,
    mention: MentionLabel = ownId,
): RichInline[] {
    return nodes.flatMap((node): RichInline[] => {
        if (node.type === 'text') return [textNode(node, vars)]
        if (node.type === 'hardBreak') return [{ type: 'br' }]
        if (node.type === PRIVACY_BLOCK_MENTION)
            return [{ type: 'text', text: mention(String(node.attrs?.id)) }]
        return inlines(node.content, vars, mention)
    })
}

export function richTextBlocks(
    doc: RichTextNode | undefined,
    vars: RichTextVars = {},
    mention: MentionLabel = ownId,
): RichBlock[] {
    return (doc?.content ?? []).flatMap((node): RichBlock[] => {
        switch (node.type) {
            case 'heading':
                return [
                    {
                        type: Number(node.attrs?.level ?? 3) <= 3 ? 'h3' : 'h4',
                        children: inlines(node.content, vars, mention),
                    },
                ]
            case 'bulletList':
            case 'orderedList':
                return [
                    {
                        type: node.type === 'bulletList' ? 'ul' : 'ol',
                        items: (node.content ?? []).map((item) =>
                            richTextBlocks(item, vars, mention),
                        ),
                    },
                ]
            case 'blockquote':
                return richTextBlocks(node, vars, mention)
            default: {
                const children = inlines(node.content, vars, mention)
                return children.length ? [{ type: 'p', children }] : []
            }
        }
    })
}

export type PrivacySection =
    | { type: 'block'; key: PrivacyBlockKey }
    | { type: 'text'; title: RichInline[]; blocks: RichBlock[] }

const startsSection = (node: RichTextNode) =>
    node.type === 'heading' && Number(node.attrs?.level ?? 2) <= 2

export function privacySections(
    doc: RichTextDoc,
    vars: RichTextVars = {},
    mention: MentionLabel = ownId,
): PrivacySection[] {
    const sections: PrivacySection[] = []
    let title: RichInline[] = []
    let nodes: RichTextNode[] = []
    const flush = () => {
        const blocks = richTextBlocks(
            { type: 'doc', content: nodes },
            vars,
            mention,
        )
        if (title.length || blocks.length)
            sections.push({ type: 'text', title, blocks })
        title = []
        nodes = []
    }
    for (const node of doc.content) {
        const key = privacyBlockKeyOf(node)
        if (key !== undefined) {
            flush()
            if (isPrivacyBlockKey(key)) sections.push({ type: 'block', key })
        } else if (startsSection(node)) {
            flush()
            title = inlines(node.content, vars, mention)
        } else {
            nodes.push(node)
        }
    }
    flush()
    return sections
}
