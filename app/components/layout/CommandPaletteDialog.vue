<template>
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
            <UCommandPalette
                v-model:search-term="query"
                :groups="groups"
                :fuse="{ resultLimit: Infinity }"
                :loading="searching"
                :placeholder="$t('nav.commandPalettePlaceholder')"
                :input="inputAttrs"
                :ui="{
                    content: 'max-h-[min(65dvh,640px)]',
                    viewport: '[scrollbar-width:thin]',
                    footer: 'px-4 py-2',
                    empty: searching ? 'hidden' : '',
                }"
                data-testid="command-palette"
            >
                <template #item-leading="{ item }">
                    <span
                        v-if="item.color"
                        class="size-3.5 shrink-0 rounded-full ring-1 ring-default"
                        :style="{ background: routeDotColor(item.color) }"
                    />
                    <UIcon
                        v-else-if="item.icon"
                        :name="item.icon"
                        class="size-5 shrink-0"
                    />
                </template>
                <template #group-label="{ group, label }">
                    <span :data-testid="`command-palette-group-${group.id}`">{{
                        label
                    }}</span>
                </template>
                <template #empty>
                    <div data-testid="command-palette-empty">
                        {{ $t('nav.commandPaletteEmpty') }}
                    </div>
                </template>
                <template #footer>
                    <div class="flex flex-wrap gap-4 text-xs text-muted">
                        <span class="flex items-center gap-1">
                            <UKbd value="arrowup" /><UKbd value="arrowdown" />
                            {{ $t('nav.paletteNavigate') }}
                        </span>
                        <span class="flex items-center gap-1">
                            <UKbd value="enter" /> {{ $t('nav.paletteOpen') }}
                        </span>
                        <span class="flex items-center gap-1">
                            <UKbd value="escape" /> {{ $t('nav.paletteClose') }}
                        </span>
                    </div>
                </template>
            </UCommandPalette>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core'
import type { SearchGroup, SearchResult } from '~/composables/useGlobalSearch'
import { paletteGroups } from '~/utils/commandPalette'
import { routeDotColor } from '~/utils/color'

const props = defineProps<{
    pages: { to: string; icon: string; label: string }[]
}>()

const { t } = useI18n()
const { search } = useGlobalSearch()
const open = defineModel<boolean>('open', { required: true })
const query = ref('')
const searching = ref(false)
const remoteGroups = ref<SearchGroup[]>([])
// UCommandPalette types `input` as InputProps; the attributes still reach the <input>
const inputAttrs = computed(() => ({
    size: 'xl' as const,
    'data-testid': 'command-palette-input',
    'aria-label': t('nav.commandPalettePlaceholder'),
}))

const groups = computed(() =>
    paletteGroups(
        props.pages.map((page) => ({
            key: `page-${page.to}`,
            to: page.to,
            icon: page.icon,
            title: t(page.label),
        })),
        remoteGroups.value,
        t,
        choose,
    ),
)

let searchRun = 0

const { start: searchSoon, stop: cancelSearch } = useTimeoutFn(
    async (value: string, run: number) => {
        const found = await search(value)
        if (run !== searchRun) return
        remoteGroups.value = found
        searching.value = false
    },
    200,
    { immediate: false },
)

watch(query, (value) => {
    cancelSearch()
    const run = ++searchRun
    if (!value.trim()) {
        remoteGroups.value = []
        searching.value = false
        return
    }
    searching.value = true
    searchSoon(value, run)
})

function choose(result: SearchResult) {
    open.value = false
    navigateTo(result.to)
}
</script>
