// Mirrored in backend/internal/gyms/privacy.go (fixture testdata/privacyDoc.json).
export const PRIVACY_TEXT_SECTIONS = [
    'scope',
    'serverLogs',
    'accounts',
    'privacySettings',
    'logbook',
    'friends',
    'profiles',
    'leaderboards',
    'ratings',
    'betaVideos',
    'achievements',
    'competitions',
    'defects',
    'reports',
    'notifications',
    'push',
    'dataExport',
    'deletion',
    'auditLog',
    'captcha',
    'map',
    'thirdParties',
] as const

export const PRIVACY_DATA_BLOCKS = [
    'controller',
    'contact',
    'storage',
    'rights',
] as const

export const REQUIRED_PRIVACY_BLOCKS = ['controller', 'rights'] as const

// A built-in section is a top-level paragraph holding one mention of it.
export const PRIVACY_BLOCK_MENTION = 'mention'

// Characters of the serialised document.
export const MAX_PRIVACY_DOC = 100000

export type PrivacyTextSection = (typeof PRIVACY_TEXT_SECTIONS)[number]
export type PrivacyBlockKey =
    PrivacyTextSection | (typeof PRIVACY_DATA_BLOCKS)[number]

export interface RichTextNode {
    type: string
    text?: string
    attrs?: Record<string, unknown>
    marks?: { type: string; attrs?: Record<string, unknown> }[]
    content?: RichTextNode[]
}

export interface RichTextDoc extends RichTextNode {
    type: 'doc'
    content: RichTextNode[]
}

export const PRIVACY_BLOCK_KEYS: PrivacyBlockKey[] = [
    'controller',
    ...PRIVACY_TEXT_SECTIONS,
    'storage',
    'rights',
]

export const privacyBlockNode = (key: PrivacyBlockKey): RichTextNode => ({
    type: 'paragraph',
    content: [{ type: PRIVACY_BLOCK_MENTION, attrs: { id: key } }],
})

const isBlank = (node: RichTextNode) =>
    node.type === 'text' && !node.text?.trim()

export function privacyBlockKeyOf(node: RichTextNode): unknown {
    if (node.type !== 'paragraph') return undefined
    const content = (node.content ?? []).filter((child) => !isBlank(child))
    return content.length === 1 && content[0]!.type === PRIVACY_BLOCK_MENTION
        ? (content[0]!.attrs?.id ?? null)
        : undefined
}

export const DEFAULT_PRIVACY_DOC: RichTextDoc = {
    type: 'doc',
    content: PRIVACY_BLOCK_KEYS.map(privacyBlockNode),
}

export function isPrivacyTextSection(key: unknown): key is PrivacyTextSection {
    return (PRIVACY_TEXT_SECTIONS as readonly unknown[]).includes(key)
}

export function isPrivacyBlockKey(key: unknown): key is PrivacyBlockKey {
    return (
        isPrivacyTextSection(key) ||
        (PRIVACY_DATA_BLOCKS as readonly unknown[]).includes(key)
    )
}

export function isRequiredPrivacyBlock(key: unknown) {
    return (REQUIRED_PRIVACY_BLOCKS as readonly unknown[]).includes(key)
}

export function privacyBlockKeys(doc: RichTextDoc): unknown[] {
    return doc.content.map(privacyBlockKeyOf).filter((key) => key !== undefined)
}

export function missingPrivacyBlocks(doc: RichTextDoc): PrivacyBlockKey[] {
    const present = new Set(privacyBlockKeys(doc))
    return [...PRIVACY_BLOCK_KEYS, 'contact' as const].filter(
        (key) => !present.has(key),
    )
}

export function hasRequiredPrivacyBlocks(doc: RichTextDoc) {
    const present = privacyBlockKeys(doc)
    return REQUIRED_PRIVACY_BLOCKS.every((key) => present.includes(key))
}

export function isValidPrivacyDoc(value: unknown): boolean {
    if (value === null) return true
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false
    const doc = value as RichTextDoc
    if (doc.type !== 'doc' || !Array.isArray(doc.content)) return false
    if ([...JSON.stringify(doc)].length > MAX_PRIVACY_DOC) return false
    const seen = new Set<unknown>()
    for (const node of doc.content) {
        if (!node || typeof node !== 'object') return false
        const key = privacyBlockKeyOf(node)
        if (key === undefined) continue
        if (!isPrivacyBlockKey(key) || seen.has(key)) return false
        seen.add(key)
    }
    return REQUIRED_PRIVACY_BLOCKS.every((key) => seen.has(key))
}

export function privacyDocOrDefault(
    doc: RichTextDoc | null | undefined,
): RichTextDoc {
    return doc?.content?.length ? doc : DEFAULT_PRIVACY_DOC
}

function withoutMentionLabels(node: RichTextNode): RichTextNode {
    if (node.type === PRIVACY_BLOCK_MENTION)
        return { ...node, attrs: { id: node.attrs?.id } }
    return node.content
        ? { ...node, content: node.content.map(withoutMentionLabels) }
        : node
}

export function privacyDocPayload(doc: RichTextDoc): RichTextDoc | null {
    const stored = withoutMentionLabels(doc) as RichTextDoc
    return JSON.stringify(stored) === JSON.stringify(DEFAULT_PRIVACY_DOC)
        ? null
        : stored
}

export function richTextFromPlain(text: string): RichTextNode[] {
    return text
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => ({
            type: 'paragraph',
            content: paragraph
                .split('\n')
                .flatMap((line, index) => [
                    ...(index ? [{ type: 'hardBreak' }] : []),
                    { type: 'text', text: line.trim() },
                ]),
        }))
}

export function moveTopLevelNode(
    doc: RichTextDoc,
    from: number,
    to: number,
): RichTextDoc {
    const content = [...doc.content]
    if (from < 0 || from >= content.length || from === to) return doc
    const [node] = content.splice(from, 1)
    content.splice(Math.max(0, Math.min(to, content.length)), 0, node!)
    return { ...doc, content }
}

const isSectionMention = (node: RichTextNode) =>
    node.type === PRIVACY_BLOCK_MENTION && isPrivacyBlockKey(node.attrs?.id)

function hasSectionMention(node: RichTextNode): boolean {
    return (node.content ?? []).some(
        (child) => isSectionMention(child) || hasSectionMention(child),
    )
}

function withoutSectionMentions(node: RichTextNode): RichTextNode {
    return node.content
        ? {
              ...node,
              content: node.content
                  .filter((child) => !isSectionMention(child))
                  .map(withoutSectionMentions),
          }
        : node
}

function sectionMentions(node: RichTextNode): RichTextNode[] {
    return (node.content ?? []).flatMap((child) =>
        isSectionMention(child) ? [child] : sectionMentions(child),
    )
}

const hasText = (node: RichTextNode): boolean =>
    !!node.text?.trim() || (node.content ?? []).some(hasText)

function splitParagraph(node: RichTextNode): RichTextNode[] {
    const parts: RichTextNode[] = []
    let run: RichTextNode[] = []
    const flush = () => {
        if (run.some((child) => !isBlank(child)))
            parts.push({ ...node, content: run })
        run = []
    }
    for (const child of node.content ?? []) {
        if (isSectionMention(child)) {
            flush()
            parts.push({ type: 'paragraph', content: [child] })
        } else {
            run.push(child)
        }
    }
    flush()
    return parts
}

// Sections stay whole paragraphs, whatever gets typed or formatted around them.
export function separatePrivacyBlocks(doc: RichTextDoc): RichTextDoc {
    let changed = false
    const content = doc.content.flatMap((node) => {
        if (privacyBlockKeyOf(node) !== undefined || !hasSectionMention(node))
            return [node]
        changed = true
        if (node.type === 'paragraph') return splitParagraph(node)
        const rest = withoutSectionMentions(node)
        return [
            ...sectionMentions(node).map((mention) => ({
                type: 'paragraph',
                content: [mention],
            })),
            ...(hasText(rest) ? [rest] : []),
        ]
    })
    return changed ? { ...doc, content } : doc
}
