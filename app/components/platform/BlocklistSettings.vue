<template>
    <LayoutEmptyState
        v-if="error"
        variant="error"
        :title="t('errors.loadFailed')"
    />
    <UForm
        v-else
        ref="blocklistForm"
        :state="form"
        class="flex flex-col gap-6"
        data-testid="platform-blocklist-settings"
        @submit="save"
    >
        <UPageCard
            :title="t('platform.settings.blocklists.emailsTitle')"
            variant="outline"
            :ui="SETTINGS_CARD_UI"
        >
            <div class="flex flex-col gap-2 lg:col-span-2">
                <LayoutEyebrow>
                    {{ t('platform.settings.blocklists.sources') }}
                </LayoutEyebrow>
                <LayoutListGroup>
                    <LayoutListRow
                        v-for="source in sources"
                        :key="source.id"
                        :data-testid="`platform-email-source-${source.id}`"
                    >
                        <USwitch
                            :model-value="source.enabled"
                            :disabled="busySource === source.id"
                            :aria-label="source.name"
                            :data-testid="`platform-email-source-toggle-${source.id}`"
                            @update:model-value="
                                (enabled: boolean) => toggle(source, enabled)
                            "
                        />
                        <div class="min-w-0 flex-1">
                            <div
                                class="flex flex-wrap items-center gap-2 font-medium"
                            >
                                <ULink
                                    :to="source.homepage"
                                    target="_blank"
                                    rel="noopener"
                                    class="truncate"
                                >
                                    {{ source.name }}
                                </ULink>
                                <UBadge
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                >
                                    {{ source.license }}
                                </UBadge>
                            </div>
                            <div class="truncate text-sm text-muted">
                                {{ emailSourceSummary(source, t, locale) }}
                            </div>
                            <div
                                v-if="source.last_error"
                                class="text-sm break-words text-error"
                                :data-testid="`platform-email-source-error-${source.id}`"
                            >
                                {{ source.last_error }}
                            </div>
                        </div>
                        <UButton
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-list"
                            class="icon-btn"
                            :disabled="!source.domain_count"
                            :aria-label="
                                t('platform.settings.blocklists.viewList')
                            "
                            :data-testid="`platform-email-source-view-${source.id}`"
                            @click="viewing = source"
                        />
                        <UButton
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-refresh-cw"
                            class="icon-btn"
                            :loading="busySource === source.id"
                            :disabled="!!busySource"
                            :aria-label="
                                t('platform.settings.blocklists.syncNow')
                            "
                            :data-testid="`platform-email-source-sync-${source.id}`"
                            @click="sync(source)"
                        />
                    </LayoutListRow>
                </LayoutListGroup>
            </div>
            <UFormField
                :label="t('platform.settings.blocklists.emails')"
                name="blocked_emails"
                :ui="SETTINGS_FIELD_UI"
            >
                <UTextarea
                    v-model="form.blocked_emails"
                    :rows="6"
                    autoresize
                    placeholder="spam.example&#10;*.example.net&#10;someone@example.com"
                    class="w-full font-mono"
                    data-testid="platform-blocklist-emails"
                />
            </UFormField>
            <UFormField
                :label="t('platform.settings.blocklists.allowed')"
                name="allowed_emails"
                :ui="SETTINGS_FIELD_UI"
            >
                <UTextarea
                    v-model="form.allowed_emails"
                    :rows="6"
                    autoresize
                    placeholder="partner.example&#10;coach@example.com"
                    class="w-full font-mono"
                    data-testid="platform-blocklist-allowed"
                />
            </UFormField>
            <div class="lg:col-span-2">
                <PlatformBlocklistCheck
                    kind="email"
                    :lists="currentLists"
                    :sources="sources"
                />
            </div>
        </UPageCard>

        <UPageCard
            :title="t('platform.settings.blocklists.names')"
            variant="outline"
            :ui="SETTINGS_CARD_UI"
        >
            <UFormField
                :label="t('platform.settings.blocklists.namesField')"
                name="protected_names"
                :ui="SETTINGS_FIELD_UI"
                class="lg:col-span-2"
            >
                <UTextarea
                    v-model="form.protected_names"
                    :rows="6"
                    autoresize
                    class="w-full font-mono"
                    data-testid="platform-blocklist-names"
                />
            </UFormField>
            <div class="lg:col-span-2">
                <PlatformBlocklistCheck
                    kind="name"
                    :lists="currentLists"
                    :sources="sources"
                />
            </div>
        </UPageCard>

        <PlatformEmailSourceDialog
            :model-value="!!viewing"
            :source="viewing"
            @update:model-value="
                (isOpen: boolean) => !isOpen && (viewing = null)
            "
        />
    </UForm>
</template>

<script setup lang="ts">
import type { Form } from '@nuxt/ui'
import {
    getBlocklists,
    setEmailSource,
    syncEmailSource,
    updateBlocklists,
    type BlocklistSettings,
    type EmailSource,
} from '~/api/platform'
import { emailSourceSummary } from '~/utils/emailSources'
import { linesToList, refusedEntries } from '~/utils/fieldErrors'
import { CLIENT_ONLY } from '~/utils/platformMail'
import { SETTINGS_CARD_UI, SETTINGS_FIELD_UI } from '~/utils/settingsUi'

const { t, locale } = useI18n()
const { error: notifyError } = useNotification()

const {
    data: lists,
    error,
    refresh,
} = useAsyncData('platform-blocklists', getBlocklists, CLIENT_ONLY)

function formFrom(rec: BlocklistSettings | null | undefined) {
    return {
        blocked_emails: (rec?.blocked_emails ?? []).join('\n'),
        allowed_emails: (rec?.allowed_emails ?? []).join('\n'),
        protected_names: (rec?.protected_names ?? []).join('\n'),
    }
}

const form = reactive(formFrom(lists.value))
const blocklistForm = ref<Form<typeof form> | null>(null)
watch(lists, (rec, previous) => {
    if (JSON.stringify(form) === JSON.stringify(formFrom(previous)))
        Object.assign(form, formFrom(rec))
})

const sources = computed(() => lists.value?.sources ?? [])
const currentLists = computed(() => ({
    blocked_emails: linesToList(form.blocked_emails),
    allowed_emails: linesToList(form.allowed_emails),
    protected_names: linesToList(form.protected_names),
}))

const hasChanges = computed(
    () => JSON.stringify(form) !== JSON.stringify(formFrom(lists.value)),
)

const { pending: saving, run: runSave } = useAsyncAction()

async function save() {
    const sent = currentLists.value
    await runSave(
        async () => {
            try {
                lists.value = await updateBlocklists(sent)
                Object.assign(form, formFrom(lists.value))
            } catch (err) {
                const errors = (
                    [
                        'blocked_emails',
                        'allowed_emails',
                        'protected_names',
                    ] as const
                )
                    .map((name) => ({
                        name,
                        refused: refusedEntries(err, name, sent[name]),
                    }))
                    .filter(({ refused }) => refused.length)
                    .map(({ name, refused }) => ({
                        name,
                        message: t('platform.settings.blocklists.invalid', {
                            entries: refused.join(', '),
                        }),
                    }))
                blocklistForm.value?.setErrors(errors)
                throw err
            }
        },
        {
            success: t('settings.saveSuccess'),
            error: t('settings.saveError'),
        },
    )
}

const busySource = ref('')
const viewing = ref<EmailSource | null>(null)

// Sources apply at once; only the source state is taken over, so unsaved list edits stay in the form.
async function runSource(
    source: EmailSource,
    action: () => Promise<BlocklistSettings>,
) {
    busySource.value = source.id
    try {
        const updated = await action()
        if (lists.value)
            lists.value = { ...lists.value, sources: updated.sources }
    } catch (err) {
        console.error(err)
        notifyError(t('settings.saveError'))
    } finally {
        busySource.value = ''
    }
}

function toggle(source: EmailSource, enabled: boolean) {
    return runSource(source, () => setEmailSource(source.id, enabled))
}

function sync(source: EmailSource) {
    return runSource(source, () => syncEmailSource(source.id))
}

defineExpose({
    submit: () => blocklistForm.value?.submit(),
    reset: () => Object.assign(form, formFrom(lists.value)),
    refresh,
    hasChanges,
    saving,
})
</script>
