<template>
    <div
        class="flex w-full min-w-0 flex-col gap-3"
        :data-testid="`${testIdPrefix}-privacy`"
    >
        <SegmentedControl
            v-model="mode"
            class="self-start"
            :items="modes"
            :test-id="`${testIdPrefix}-privacy-mode`"
        />

        <UAlert
            v-if="problem"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="problem"
            :data-testid="`${testIdPrefix}-privacy-missing`"
        />

        <div
            v-show="mode === 'edit'"
            ref="surface"
            class="privacy-editor relative rounded-md ring ring-default"
            :data-testid="`${testIdPrefix}-privacy-editor`"
            @pointermove="hover"
            @pointerdown="hover"
            @click="placeCaretAfterSection"
            @pointerleave="leave"
        >
            <UEditor
                v-slot="{ editor }"
                v-model="editorDoc"
                content-type="json"
                :mention="{ deleteTriggerWithBackspace: true }"
                :image="false"
                :editor-props="{ handleKeyDown: keepCaretInSection }"
                :placeholder="$t('settings.privacy.placeholder')"
                class="min-h-96 w-full"
                :ui="{ base: 'ps-9 pe-3 py-4 sm:ps-10 sm:pe-6 *:my-3' }"
            >
                <UEditorToolbar
                    :editor="editor"
                    :items="toolbarItems(editor)"
                    class="sticky top-0 z-10 overflow-x-auto border-b border-default bg-default px-2 py-1 [scrollbar-width:none]"
                />
                <UEditorMentionMenu :editor="editor" :items="sectionItems" />
            </UEditor>
            <div
                v-if="handle"
                class="block-grip absolute left-0.5 flex flex-col gap-4"
                :style="{ top: `${handle.top}px` }"
            >
                <UButton
                    class="grip icon-btn"
                    icon="i-lucide-grip-vertical"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :aria-label="$t('settings.privacy.moveBlock')"
                    :data-testid="`${testIdPrefix}-privacy-grip`"
                    @pointerdown.prevent="startDrag"
                    @keydown.up.prevent="nudge(-1)"
                    @keydown.down.prevent="nudge(1)"
                    @keydown.delete.prevent="
                        handle.removable && removeBlock(handle.index)
                    "
                />
                <UButton
                    v-if="handle.removable"
                    class="icon-btn"
                    icon="i-lucide-trash-2"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :aria-label="$t('settings.privacy.remove')"
                    :data-testid="`${testIdPrefix}-privacy-remove`"
                    @click="removeBlock(handle.index)"
                />
            </div>
            <div
                v-if="dropLine !== null"
                class="pointer-events-none absolute inset-x-8 h-0.5 rounded bg-primary"
                :style="{ top: `${dropLine}px` }"
            />
        </div>

        <LegalPrivacyDoc
            v-if="mode === 'preview'"
            :controller="{ ...controller, privacy_doc: doc }"
            :imprint-path="imprintPath"
            :audit-retention-days="auditDays"
            :data-testid="`${testIdPrefix}-privacy-preview`"
        />
    </div>
</template>

<script setup lang="ts">
import type { EditorSlots, EditorToolbarItem } from '@nuxt/ui'
import type { LegalFields, SettingsRecord } from '~/types/models'
import {
    PRIVACY_BLOCK_KEYS,
    PRIVACY_BLOCK_MENTION,
    isPrivacyBlockKey,
    isPrivacyTextSection,
    isRequiredPrivacyBlock,
    missingPrivacyBlocks,
    moveTopLevelNode,
    privacyBlockKeyOf,
    privacyBlockNode,
    richTextFromPlain,
    separatePrivacyBlocks,
    type PrivacyBlockKey,
    type RichTextDoc,
    type RichTextNode,
} from '#shared/utils/privacyDoc'
import {
    PRIVACY_PLACEHOLDERS,
    privacyBlockText,
    privacyDocProblem,
    privacyBlockTitleKey,
} from '~/utils/privacyEditor'

type Editor = Parameters<NonNullable<EditorSlots['default']>>[0]['editor']

const props = withDefaults(
    defineProps<{
        controller: LegalFields & { name?: string }
        imprintPath: string
        testIdPrefix?: string
    }>(),
    { testIdPrefix: 'settings' },
)
const doc = defineModel<RichTextDoc>('doc', { required: true })

const { t } = useI18n()
const { data: settings } = useNuxtData<SettingsRecord>('settings')
const mode = ref<'edit' | 'preview'>('edit')

const modes = computed(() => [
    {
        value: 'edit' as const,
        label: t('settings.privacy.editMode'),
        icon: 'i-lucide-pencil',
    },
    {
        value: 'preview' as const,
        label: t('settings.privacy.preview'),
        icon: 'i-lucide-eye',
    },
])

const titleOf = (key: PrivacyBlockKey) => t(privacyBlockTitleKey(key))

const problem = computed(() => privacyDocProblem(doc.value, t))

const surface = useTemplateRef<HTMLElement>('surface')
const handle = ref<{ index: number; top: number; removable: boolean } | null>(
    null,
)
const dropLine = ref<number | null>(null)
let dragging = false

function blockElements() {
    const root = surface.value?.querySelector('.ProseMirror')
    const blocks = Array.from(root?.children ?? []).filter(
        (element) => !element.classList.contains('ProseMirror-gapcursor'),
    ) as HTMLElement[]
    return blocks.length === doc.value.content.length ? blocks : []
}

function offsetTop(element: HTMLElement) {
    return (
        element.getBoundingClientRect().top -
        surface.value!.getBoundingClientRect().top
    )
}

function showHandle(index: number) {
    const element = blockElements()[index]
    const key = privacyBlockKeyOf(doc.value.content[index]!)
    handle.value = element
        ? {
              index,
              top: offsetTop(element),
              removable: !isRequiredPrivacyBlock(key),
          }
        : null
}

function removeBlock(index: number) {
    doc.value = {
        ...doc.value,
        content: doc.value.content.filter((_, position) => position !== index),
    }
    handle.value = null
}

function hover(event: PointerEvent) {
    if (dragging) return
    const target = event.target as Element
    if (target.closest('.block-grip')) return
    const element = target.closest('.ProseMirror > *')
    const index = blockElements().indexOf(element as HTMLElement)
    if (index >= 0) showHandle(index)
}

function placeCaretAfterSection(event: MouseEvent) {
    const mention = (event.target as Element).closest('.mention')
    const editor = currentEditor
    if (!mention || !editor) return
    editor.view.focus()
    editor.commands.setTextSelection(editor.view.posAtDOM(mention, 0) + 1)
}

// The browser's own Home/End jump past the multi-line, non-editable section text.
function keepCaretInSection(
    view: Editor['view'],
    event: KeyboardEvent,
): boolean {
    if (event.key !== 'Home' && event.key !== 'End') return false
    const { $from } = view.state.selection
    const parent = $from.parent
    if (
        parent.childCount !== 1 ||
        parent.firstChild?.type.name !== PRIVACY_BLOCK_MENTION
    )
        return false
    const pos = event.key === 'Home' ? $from.start() : $from.end()
    currentEditor?.commands.setTextSelection(pos)
    return true
}

function leave() {
    if (!dragging) handle.value = null
}

function dropIndex(clientY: number, blocks: HTMLElement[]) {
    const index = blocks.findIndex((element) => {
        const rect = element.getBoundingClientRect()
        return clientY < rect.top + rect.height / 2
    })
    return index < 0 ? blocks.length : index
}

function move(from: number, to: number) {
    doc.value = moveTopLevelNode(doc.value, from, to)
    nextTick(() => showHandle(to))
}

function startDrag(event: PointerEvent) {
    if (!handle.value) return
    const from = handle.value.index
    const blocks = blockElements()
    dragging = true
    let target = from
    const onMove = (moveEvent: PointerEvent) => {
        target = dropIndex(moveEvent.clientY, blocks)
        const edge =
            target < blocks.length
                ? offsetTop(blocks[target]!)
                : offsetTop(blocks.at(-1)!) + blocks.at(-1)!.offsetHeight
        dropLine.value = edge - 2
    }
    const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        dragging = false
        dropLine.value = null
        if (target !== from && target !== from + 1)
            move(from, target > from ? target - 1 : target)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    onMove(event)
}

function nudge(step: number) {
    if (!handle.value) return
    const to = handle.value.index + step
    if (to >= 0 && to < doc.value.content.length) move(handle.value.index, to)
}

const auditDays = computed(() => settings.value?.audit_retention_days ?? 90)

function withLabels(node: RichTextNode): RichTextNode {
    if (node.type === PRIVACY_BLOCK_MENTION) {
        const id = node.attrs?.id
        return {
            ...node,
            attrs: {
                id,
                // The word joiner keeps ::first-letter (which hides the "@") off the title.
                label: isPrivacyBlockKey(id)
                    ? '\u2060' +
                      privacyBlockText(id, t, {
                          controller: props.controller,
                          auditDays: auditDays.value,
                      })
                    : String(id),
                mentionSuggestionChar: '@',
            },
        }
    }
    const content =
        privacyBlockKeyOf(node) === undefined
            ? node.content
            : node.content?.filter((child) => child.type !== 'text')
    return content ? { ...node, content: content.map(withLabels) } : node
}

let currentEditor: Editor | null = null

function caretAfterSplit() {
    const editor = currentEditor
    if (!editor) return null
    const { selection, doc: before } = editor.state
    const { $from } = selection
    const afterSection = Array.from({ length: $from.index() }, (_, index) =>
        $from.parent.child(index),
    ).some((node) => node.type.name === PRIVACY_BLOCK_MENTION)
    const fromEnd = before.content.size - selection.from
    return () => {
        const size = editor.state.doc.content.size
        editor.commands.setTextSelection(
            afterSection ? size - fromEnd : selection.from,
        )
    }
}

const editorDoc = computed({
    get: () => withLabels(doc.value) as RichTextDoc,
    set: (value) => {
        const separated = separatePrivacyBlocks(value)
        const restoreCaret = separated !== value && caretAfterSplit()
        doc.value = separated
        if (restoreCaret) nextTick(restoreCaret)
    },
})

// The mention menu matches entries by identity, so only the filter may change while typing.
const allSectionItems = computed(() =>
    [...PRIVACY_BLOCK_KEYS, 'contact' as const].map((key) => ({
        id: key,
        label: titleOf(key),
    })),
)

const sectionItems = computed(() => {
    const missing: string[] = missingPrivacyBlocks(doc.value)
    return allSectionItems.value.filter((item) => missing.includes(item.id))
})

function insertSection(editor: Editor, key: PrivacyBlockKey) {
    editor
        .chain()
        .focus()
        .insertContent(withLabels(privacyBlockNode(key)))
        .run()
}

function insertSectionText(editor: Editor, key: PrivacyBlockKey) {
    editor
        .chain()
        .focus()
        .insertContent([
            {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: titleOf(key) }],
            },
            ...richTextFromPlain(
                t(`legal.privacyPage.${key}.body`, {
                    auditDays: '{auditDays}',
                }),
            ),
        ])
        .run()
}

function toolbarItems(editor: Editor): EditorToolbarItem[][] {
    currentEditor = editor
    const missing = missingPrivacyBlocks(doc.value)
    return [
        [
            {
                kind: 'heading',
                level: 2,
                icon: 'i-lucide-heading-2',
                'aria-label': t('settings.privacy.sectionTitle'),
            },
            {
                kind: 'heading',
                level: 3,
                icon: 'i-lucide-heading-3',
                'aria-label': t('settings.privacy.subheading'),
            },
            {
                kind: 'mark',
                mark: 'bold',
                icon: 'i-lucide-bold',
                'aria-label': t('settings.privacy.bold'),
            },
            {
                kind: 'mark',
                mark: 'italic',
                icon: 'i-lucide-italic',
                'aria-label': t('settings.privacy.italic'),
            },
        ],
        [
            {
                kind: 'bulletList',
                icon: 'i-lucide-list',
                'aria-label': t('settings.privacy.bulletList'),
            },
            {
                kind: 'orderedList',
                icon: 'i-lucide-list-ordered',
                'aria-label': t('settings.privacy.orderedList'),
            },
        ],
        [
            {
                icon: 'i-lucide-blocks',
                label: t('settings.privacy.add'),
                items: [
                    missing.map((key) => ({
                        label: titleOf(key),
                        onSelect: () => insertSection(editor, key),
                    })),
                    [
                        {
                            label: t('settings.privacy.asText'),
                            icon: 'i-lucide-pencil',
                            children: PRIVACY_BLOCK_KEYS.filter(
                                isPrivacyTextSection,
                            ).map((key) => ({
                                label: titleOf(key),
                                onSelect: () => insertSectionText(editor, key),
                            })),
                        },
                    ],
                ].filter((group) => group.length),
            },
            {
                icon: 'i-lucide-braces',
                label: t('settings.privacy.insert'),
                items: PRIVACY_PLACEHOLDERS.map((name) => ({
                    label: t(`settings.privacy.placeholders.${name}`),
                    onSelect: () =>
                        editor.chain().focus().insertContent(`{${name}}`).run(),
                })),
            },
        ],
    ]
}
</script>

<style scoped>
.block-grip .grip {
    touch-action: none;
    cursor: grab;
}

.privacy-editor
    :deep(
        p:has(
            > .ProseMirror-separator:first-child
                + .mention
                + .ProseMirror-separator
                + .ProseMirror-trailingBreak:last-child
        )
    ) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--ui-radius);
    background: color-mix(in oklab, var(--ui-bg-elevated) 70%, transparent);
    box-shadow: inset 0 0 0 1px var(--ui-border);
    cursor: default;
    caret-color: transparent;
}

.privacy-editor :deep(p:has(> .mention.ProseMirror-selectednode)) {
    box-shadow: inset 0 0 0 2px var(--ui-primary);
}

.privacy-editor
    :deep(
        p:has(
                > .ProseMirror-separator:first-child
                    + .mention
                    + .ProseMirror-separator
                    + .ProseMirror-trailingBreak:last-child
            )
            .mention
    ) {
    display: block;
    /* ProseMirror and the editor's utilities are unlayered, this file is layered */
    white-space: pre-line !important;
    color: var(--ui-text-toned) !important;
    font-weight: 400;
    line-height: 1.6;
}

.privacy-editor
    :deep(
        p:has(
                > .ProseMirror-separator:first-child
                    + .mention
                    + .ProseMirror-separator
                    + .ProseMirror-trailingBreak:last-child
            )
            .mention::first-letter
    ) {
    font-size: 0;
}

.privacy-editor
    :deep(
        p:has(
                > .ProseMirror-separator:first-child
                    + .mention
                    + .ProseMirror-separator
                    + .ProseMirror-trailingBreak:last-child
            )
            .mention::first-line
    ) {
    color: var(--ui-text-highlighted) !important;
    font-weight: 600;
}
</style>
