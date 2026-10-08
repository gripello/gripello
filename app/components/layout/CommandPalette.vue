<template>
    <UButton
        class="icon-btn"
        icon="i-lucide-search"
        color="neutral"
        variant="ghost"
        size="xl"
        data-testid="command-palette-open"
        :aria-label="`${$t('nav.commandPalette')} (${shortcutLabel})`"
        @click="open = true"
    />

    <UModal
        v-model:open="open"
        :title="$t('nav.commandPalette')"
        :ui="{
            content:
                'sm:max-w-[min(760px,calc(100vw-4rem))] rounded-xl sm:top-[10vh] sm:translate-y-0',
        }"
        @after:leave="query = ''"
    >
        <template #content>
            <div data-testid="command-palette">
                <UInput
                    v-model="query"
                    autofocus
                    variant="none"
                    size="xl"
                    class="w-full"
                    icon="i-lucide-search"
                    :loading="searching"
                    :placeholder="$t('nav.commandPalettePlaceholder')"
                    :aria-label="$t('nav.commandPalettePlaceholder')"
                    data-testid="command-palette-input"
                    @keydown.down.prevent="moveActive(1)"
                    @keydown.up.prevent="moveActive(-1)"
                    @keydown.enter.prevent="choose(results[activeIndex])"
                />
                <USeparator />

                <div
                    v-if="results.length"
                    ref="resultList"
                    class="max-h-[min(65vh,640px)] overflow-y-auto p-2"
                >
                    <template v-for="group in groups" :key="group.key">
                        <div
                            class="px-3 pt-2 pb-1 text-xs font-medium text-muted"
                            :data-testid="`command-palette-group-${group.key}`"
                        >
                            {{ $t(group.label) }}
                        </div>
                        <button
                            v-for="result in group.items"
                            :key="result.key"
                            type="button"
                            class="palette-item"
                            :class="{
                                'is-active': result.index === activeIndex,
                            }"
                            :aria-current="
                                result.index === activeIndex
                                    ? 'true'
                                    : undefined
                            "
                            data-testid="command-palette-result"
                            @click="choose(result)"
                            @mousemove="activeIndex = result.index"
                        >
                            <span
                                v-if="result.color"
                                class="route-dot"
                                :style="{ background: result.color }"
                            />
                            <UIcon
                                v-else-if="result.icon"
                                :name="result.icon"
                                class="size-5 shrink-0"
                            />
                            <span class="min-w-0 flex-1 text-start">
                                <span class="block truncate text-sm">{{
                                    result.title
                                }}</span>
                                <span
                                    v-if="result.subtitle"
                                    class="block truncate text-xs text-muted"
                                    >{{ result.subtitle }}</span
                                >
                            </span>
                        </button>
                    </template>
                </div>

                <div
                    v-else-if="!searching"
                    class="p-6 text-center text-sm text-muted"
                    data-testid="command-palette-empty"
                >
                    {{ $t('nav.commandPaletteEmpty') }}
                </div>

                <USeparator />
                <div
                    class="palette-footer flex flex-wrap gap-4 px-4 py-2 text-xs text-muted"
                >
                    <span
                        ><kbd>↑</kbd><kbd>↓</kbd>
                        {{ $t('nav.paletteNavigate') }}</span
                    >
                    <span><kbd>↵</kbd> {{ $t('nav.paletteOpen') }}</span>
                    <span><kbd>Esc</kbd> {{ $t('nav.paletteClose') }}</span>
                </div>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import type { SearchGroup, SearchResult } from '~/composables/useGlobalSearch'

const props = defineProps<{
    pages: { to: string; icon: string; label: string }[]
}>()

const { t } = useI18n()
const { search } = useGlobalSearch()
const open = ref(false)
const query = ref('')
const activeIndex = ref(0)
const searching = ref(false)
const remoteGroups = ref<SearchGroup[]>([])
const resultList = useTemplateRef<HTMLElement>('resultList')
const shortcutLabel = ref('Ctrl+K')

const pageResults = computed<SearchResult[]>(() => {
    const needle = query.value.trim().toLowerCase()
    return props.pages
        .map((page) => ({
            key: `page-${page.to}`,
            to: page.to,
            icon: page.icon,
            title: t(page.label),
        }))
        .filter((page) => page.title.toLowerCase().includes(needle))
})

const groups = computed(() => {
    let index = 0
    return [
        {
            key: 'pages',
            label: 'nav.paletteGroupPages',
            items: pageResults.value,
        },
        ...remoteGroups.value,
    ]
        .filter((group) => group.items.length)
        .map((group) => ({
            ...group,
            items: group.items.map((item) => ({ ...item, index: index++ })),
        }))
})

const results = computed(() => groups.value.flatMap((group) => group.items))

let searchDebounce: ReturnType<typeof setTimeout> | undefined

let searchRun = 0

watch(query, (value) => {
    activeIndex.value = 0
    clearTimeout(searchDebounce)
    const run = ++searchRun
    if (!value.trim()) {
        remoteGroups.value = []
        searching.value = false
        return
    }
    searching.value = true
    searchDebounce = setTimeout(async () => {
        const found = await search(value)
        if (run !== searchRun) return
        remoteGroups.value = found
        searching.value = false
    }, 200)
})

watch(activeIndex, async () => {
    await nextTick()
    resultList.value
        ?.querySelector('.is-active')
        ?.scrollIntoView({ block: 'nearest' })
})

function moveActive(step: number) {
    if (!results.value.length) return
    activeIndex.value =
        (activeIndex.value + step + results.value.length) % results.value.length
}

function choose(result: SearchResult | undefined) {
    if (!result) return
    open.value = false
    navigateTo(result.to)
}

function onShortcut(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        open.value = !open.value
    }
}

onMounted(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) shortcutLabel.value = '⌘K'
    window.addEventListener('keydown', onShortcut)
})
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onShortcut)
    clearTimeout(searchDebounce)
})
</script>

<style scoped>
.palette-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 16px;
    padding: 6px 12px;
    border-radius: 8px;
    cursor: pointer;
}

.palette-item.is-active {
    color: var(--ui-primary);
    background: color-mix(in oklab, var(--ui-primary) 10%, transparent);
}

.route-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 0 1px
        color-mix(in oklab, var(--ui-text-highlighted) 20%, transparent);
}

.palette-footer kbd {
    display: inline-block;
    min-width: 20px;
    margin-right: 2px;
    padding: 0 4px;
    border: 1px solid
        color-mix(in oklab, var(--ui-text-highlighted) 20%, transparent);
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.7rem;
    text-align: center;
}
</style>
