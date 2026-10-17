<template>
    <LayoutDialogShell
        v-model="open"
        :title="source?.name"
        :max-width="560"
        data-testid="platform-email-source-dialog"
    >
        <div class="flex flex-col gap-3">
            <UInput
                v-model="search"
                icon="i-lucide-search"
                :placeholder="t('platform.settings.blocklists.searchDomains')"
                class="w-full"
                data-testid="platform-email-source-search"
            />
            <LayoutEmptyState
                v-if="failed"
                variant="error"
                :title="t('errors.loadFailed')"
            />
            <LayoutEmptyState
                v-else-if="!loading && !domains.length"
                icon="i-lucide-search-x"
                :title="t('platform.settings.blocklists.noDomains')"
            />
            <ul
                v-else
                class="flex flex-col divide-y divide-default font-mono text-sm"
                :class="{ 'opacity-60': loading }"
                data-testid="platform-email-source-domains"
            >
                <li v-for="domain in domains" :key="domain" class="py-1.5">
                    {{ domain }}
                </li>
            </ul>
            <div
                v-if="total > limit"
                class="flex flex-wrap items-center justify-between gap-2"
            >
                <span class="text-sm text-muted">
                    {{
                        t(
                            'platform.settings.blocklists.domainCount',
                            { n: total.toLocaleString(locale) },
                            total,
                        )
                    }}
                </span>
                <UPagination
                    v-model:page="page"
                    :total="total"
                    :items-per-page="limit"
                    size="sm"
                />
            </div>
            <details v-if="source?.notice" class="text-sm">
                <summary class="cursor-pointer text-muted">
                    {{ source.license }}
                </summary>
                <pre
                    class="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs"
                    data-testid="platform-email-source-notice"
                    >{{ source.notice }}</pre>
            </details>
        </div>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { listEmailSourceDomains, type EmailSource } from '~/api/platform'

const open = defineModel<boolean>({ default: false })
const props = defineProps<{ source: EmailSource | null }>()

const { t, locale } = useI18n()

const search = ref('')
const page = ref(1)
const domains = ref<string[]>([])
const total = ref(0)
const limit = ref(100)
const loading = ref(false)
const failed = ref(false)
let request = 0

async function load() {
    const source = props.source
    if (!open.value || !source) return
    const current = ++request
    loading.value = true
    failed.value = false
    try {
        const result = await listEmailSourceDomains(
            source.id,
            search.value.trim(),
            page.value,
        )
        if (current !== request) return
        domains.value = result.items
        total.value = result.total
        limit.value = result.limit
    } catch (err) {
        if (current !== request) return
        console.error(err)
        failed.value = true
    } finally {
        if (current === request) loading.value = false
    }
}

watch(open, (isOpen) => {
    if (!isOpen) return
    search.value = ''
    page.value = 1
    domains.value = []
    total.value = 0
    load()
})
watch(page, load)

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
    clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => {
        if (page.value === 1) load()
        else page.value = 1
    }, 300)
})
</script>
