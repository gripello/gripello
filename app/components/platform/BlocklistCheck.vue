<template>
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <UInput
            v-model="value"
            :type="kind === 'email' ? 'email' : 'text'"
            :icon="
                kind === 'email'
                    ? 'i-lucide-mail-search'
                    : 'i-lucide-user-search'
            "
            :placeholder="t(`platform.settings.blocklists.test.${kind}`)"
            :aria-label="t(`platform.settings.blocklists.test.${kind}`)"
            class="w-full sm:max-w-sm"
            :data-testid="`platform-blocklist-test-${kind}`"
        />
        <UBadge
            v-if="verdict"
            :color="verdict.blocked ? 'error' : 'success'"
            variant="subtle"
            :icon="verdict.blocked ? 'i-lucide-ban' : 'i-lucide-circle-check'"
            class="max-w-full"
            :data-testid="`platform-blocklist-verdict-${kind}`"
            :data-blocked="verdict.blocked"
        >
            <span class="truncate">
                {{ t(verdict.key, { match: verdict.match }) }}
            </span>
        </UBadge>
    </div>
</template>

<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core'
import {
    checkBlocklists,
    type Blocklists,
    type EmailSource,
} from '~/api/platform'
import { blocklistVerdict, type BlocklistVerdict } from '~/utils/emailSources'

const props = defineProps<{
    kind: 'email' | 'name'
    lists: Blocklists
    sources: EmailSource[]
}>()

const { t } = useI18n()

const value = ref('')
const verdict = ref<BlocklistVerdict | null>(null)
let request = 0

async function check() {
    const current = ++request
    const input = value.value.trim()
    if (!input) {
        verdict.value = null
        return
    }
    try {
        const result = await checkBlocklists({
            ...props.lists,
            [props.kind]: input,
        })
        if (current === request)
            verdict.value = blocklistVerdict(result, props.sources)
    } catch (err) {
        console.error(err)
        if (current === request) verdict.value = null
    }
}

const { start: checkSoon } = useTimeoutFn(check, 300, { immediate: false })
watch(
    () => [value.value, props.lists, props.sources],
    () => checkSoon(),
    { deep: true },
)
</script>
