<script setup lang="ts">
import { EXPORT_COLUMNS_KEY } from '~/utils/clientStorage'
import { SUPPORTED_LOCALES, type LocaleCode } from '~/utils/locales'

export interface ExportOptions {
    locale: LocaleCode
    labels: Record<string, string>
    columns?: string[]
    show?: Record<PdfField, boolean>
}

type PdfField = 'creators' | 'date' | 'logo'

const open = defineModel<boolean>({ default: false })

const props = withDefaults(defineProps<{ format?: 'pdf' | 'xlsx' }>(), {
    format: 'xlsx',
})

const emit = defineEmits<{ confirm: [payload: ExportOptions] }>()

const { t, locale, loadLocaleMessages } = useI18n()

const exportLocale = ref(locale.value as LocaleCode)
watch(open, (isOpen) => {
    if (isOpen) exportLocale.value = locale.value as LocaleCode
})
const localeItems = SUPPORTED_LOCALES.map(({ code, name }) => ({
    title: name,
    value: code,
}))

const PDF_FIELDS: { key: PdfField; labelKey: string }[] = [
    { key: 'creators', labelKey: 'climbing.creators' },
    { key: 'date', labelKey: 'routes.screwed_at' },
    { key: 'logo', labelKey: 'export.logo' },
]
const pdfFields = ref<PdfField[]>(PDF_FIELDS.map((field) => field.key))

const EXPORT_COLUMNS = [
    { key: 'color', labelKey: 'climbing.color' },
    { key: 'name', labelKey: 'climbing.routename' },
    { key: 'difficulty', labelKey: 'climbing.difficulty' },
    { key: 'anchor_point', labelKey: 'climbing.anchor_point' },
    { key: 'comment', labelKey: 'climbing.comment' },
    { key: 'creator', labelKey: 'climbing.creators' },
    { key: 'location', labelKey: 'climbing.location' },
    { key: 'wall', labelKey: 'map.wall' },
    { key: 'type', labelKey: 'climbing.type' },
    { key: 'screw_date', labelKey: 'routes.screwed_at' },
    { key: 'qr', labelKey: 'export.qr_code' },
]

const DEFAULT_ORDER = EXPORT_COLUMNS.map((column) => column.key)
const DEFAULT_SELECTED = DEFAULT_ORDER.filter((key) => key !== 'qr')

const stored = readStored()
const order = ref<string[]>(stored.order)
const selected = ref<string[]>(stored.selected)
const dragKey = ref<string | null>(null)

const orderedColumns = computed(() =>
    order.value.map((key) =>
        EXPORT_COLUMNS.find((column) => column.key === key)!,
    ),
)
const allSelected = computed(
    () => selected.value.length === EXPORT_COLUMNS.length,
)

function sanitizeOrder(keys: unknown): string[] | null {
    if (!Array.isArray(keys)) {
        return null
    }
    const known = keys.filter((key) => DEFAULT_ORDER.includes(key))
    const missing = DEFAULT_ORDER.filter((key) => !known.includes(key))
    return known.length ? [...known, ...missing] : null
}

function readStored(): { order: string[]; selected: string[] } {
    try {
        const parsed = JSON.parse(
            localStorage.getItem(EXPORT_COLUMNS_KEY) ?? 'null',
        )
        const storedOrder = sanitizeOrder(parsed?.order)
        const storedSelected = Array.isArray(parsed?.selected)
            ? parsed.selected.filter((key: string) =>
                  DEFAULT_ORDER.includes(key),
              )
            : null
        if (storedOrder || storedSelected?.length) {
            return {
                order: storedOrder ?? [...DEFAULT_ORDER],
                selected: storedSelected?.length
                    ? storedSelected
                    : [...DEFAULT_SELECTED],
            }
        }
    } catch {}
    return { order: [...DEFAULT_ORDER], selected: [...DEFAULT_SELECTED] }
}

const moveTo = (key: string, index: number) => {
    const next = order.value.filter((entry) => entry !== key)
    next.splice(Math.max(0, Math.min(index, next.length)), 0, key)
    order.value = next
}

const move = (key: string, offset: number) =>
    moveTo(key, order.value.indexOf(key) + offset)

const onDrop = (targetKey: string) => {
    if (dragKey.value && dragKey.value !== targetKey) {
        moveTo(dragKey.value, order.value.indexOf(targetKey))
    }
    dragKey.value = null
}

function toggleIn<T>(list: T[], key: T, checked: boolean) {
    return checked
        ? [...list.filter((entry) => entry !== key), key]
        : list.filter((entry) => entry !== key)
}

const toggleAll = () => {
    selected.value = allSelected.value ? [] : [...DEFAULT_ORDER]
}

const confirm = async () => {
    await loadLocaleMessages(exportLocale.value)
    const translate = (key: string) =>
        t(key, {}, { locale: exportLocale.value })

    if (props.format === 'pdf') {
        emit('confirm', {
            locale: exportLocale.value,
            labels: { anchor: translate('climbing.anchor_point') },
            show: Object.fromEntries(
                PDF_FIELDS.map(({ key }) => [
                    key,
                    pdfFields.value.includes(key),
                ]),
            ) as Record<PdfField, boolean>,
        })
        open.value = false
        return
    }

    const columns = order.value.filter((key) => selected.value.includes(key))

    try {
        localStorage.setItem(
            EXPORT_COLUMNS_KEY,
            JSON.stringify({ order: order.value, selected: selected.value }),
        )
    } catch {}

    emit('confirm', {
        locale: exportLocale.value,
        columns,
        labels: {
            sheet: translate('page.content.index'),
            ...Object.fromEntries(
                columns.map((key) => [
                    key,
                    translate(
                        EXPORT_COLUMNS.find((column) => column.key === key)!
                            .labelKey,
                    ),
                ]),
            ),
        },
    })
    open.value = false
}
</script>

<template>
    <LayoutDialogShell
        v-model="open"
        closable
        sheet-on-mobile
        :title="$t(format === 'pdf' ? 'export.title_pdf' : 'export.title')"
        data-testid="export-options-dialog"
    >
        <UFormField :label="$t('export.language')" class="mb-4">
            <USelect
                v-model="exportLocale"
                :items="localeItems"
                label-key="title"
                class="w-full"
                data-testid="export-locale"
            />
        </UFormField>
        <div v-if="format === 'pdf'" class="flex flex-col gap-3">
            <UCheckbox
                v-for="field in PDF_FIELDS"
                :key="field.key"
                :model-value="pdfFields.includes(field.key)"
                :value="field.key"
                :label="$t(field.labelKey)"
                :data-testid="`export-show-${field.key}`"
                @update:model-value="
                    pdfFields = toggleIn(pdfFields, field.key, !!$event)
                "
            />
        </div>
        <template v-else>
            <div class="flex items-center justify-between mb-1">
                <span class="text-sm text-muted">
                    {{ $t('export.columns') }}
                </span>
                <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    data-testid="export-toggle-all"
                    @click="toggleAll"
                >
                    {{
                        allSelected
                            ? $t('actions.deselect_all')
                            : $t('actions.select_all')
                    }}
                </UButton>
            </div>
            <div
                v-for="(column, index) in orderedColumns"
                :key="column.key"
                class="export-column flex items-center"
                draggable="true"
                :data-testid="`export-column-${column.key}`"
                @dragstart="dragKey = column.key"
                @dragover.prevent
                @drop.prevent="onDrop(column.key)"
            >
                <UIcon
                    name="i-lucide-grip-horizontal"
                    class="export-column__handle size-4"
                />
                <UCheckbox
                    :model-value="selected.includes(column.key)"
                    :value="column.key"
                    :label="$t(column.labelKey)"
                    class="py-2"
                    @update:model-value="
                        selected = toggleIn(selected, column.key, !!$event)
                    "
                />
                <div class="flex-1" />
                <UButton
                    class="icon-btn"
                    icon="i-lucide-chevron-up"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :disabled="index === 0"
                    :aria-label="$t('export.move_up')"
                    :data-testid="`export-move-up-${column.key}`"
                    @click="move(column.key, -1)"
                />
                <UButton
                    class="icon-btn"
                    icon="i-lucide-chevron-down"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :disabled="index === orderedColumns.length - 1"
                    :aria-label="$t('export.move_down')"
                    :data-testid="`export-move-down-${column.key}`"
                    @click="move(column.key, 1)"
                />
            </div>
        </template>
        <template #actions>
            <UButton color="neutral" variant="ghost" @click="open = false">
                {{ $t('actions.cancel') }}
            </UButton>
            <div class="flex-1" />
            <UButton
                color="primary"
                :disabled="format === 'xlsx' && !selected.length"
                data-testid="export-confirm"
                @click="confirm"
            >
                {{ $t('actions.export') }}
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<style scoped>
.export-column__handle {
    cursor: grab;
    margin-right: 8px;
}
</style>
