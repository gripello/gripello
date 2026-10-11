<template>
    <LayoutDialogShell
        v-model="open"
        max-width="560"
        closable
        sheet-on-mobile
        :title="t('leaderboard.seasons.title')"
        data-testid="seasons-dialog"
    >
        <ul v-if="seasons.length" class="mb-4 flex flex-col gap-2">
            <li
                v-for="season in seasons"
                :key="season.id"
                class="flex items-center gap-2 rounded-lg bg-elevated/50 px-3 py-2"
                :data-testid="`season-${season.id}`"
            >
                <span class="min-w-0 flex-1">
                    <span class="block truncate font-semibold">{{
                        season.name
                    }}</span>
                    <span class="text-xs text-muted tabular-nums">
                        {{ formatDay(season.starts_at) }} –
                        {{ formatDay(season.ends_at) }}
                    </span>
                </span>
                <UButton
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="ghost"
                    class="icon-btn"
                    :aria-label="t('actions.edit')"
                    data-testid="season-edit"
                    @click="edit(season)"
                />
                <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    class="icon-btn"
                    :aria-label="t('actions.delete')"
                    data-testid="season-delete"
                    @click="deleteTarget = season"
                />
            </li>
        </ul>

        <UForm
            ref="form"
            :state="draft"
            :validate="validate"
            class="grid gap-3 sm:grid-cols-2"
            @submit="save"
        >
            <UFormField
                :label="t('leaderboard.seasons.name')"
                name="name"
                required
                class="sm:col-span-2"
            >
                <UInput
                    v-model="draft.name"
                    :maxlength="60"
                    class="w-full"
                    data-testid="season-name"
                />
            </UFormField>
            <UFormField
                :label="t('leaderboard.seasons.start')"
                name="starts_at"
                required
            >
                <UInput
                    v-model="draft.starts_at"
                    type="date"
                    class="w-full"
                    data-testid="season-start"
                />
            </UFormField>
            <UFormField
                :label="t('leaderboard.seasons.end')"
                name="ends_at"
                required
            >
                <UInput
                    v-model="draft.ends_at"
                    type="date"
                    class="w-full"
                    data-testid="season-end"
                />
            </UFormField>
        </UForm>

        <template #actions>
            <UButton
                v-if="editingId"
                color="neutral"
                variant="ghost"
                @click="reset"
            >
                {{ t('actions.cancel') }}
            </UButton>
            <div class="flex-1" />
            <UButton
                color="primary"
                :loading="pending"
                data-testid="season-save"
                @click="form?.submit()"
            >
                {{
                    editingId ? t('actions.save') : t('leaderboard.seasons.add')
                }}
            </UButton>
        </template>
    </LayoutDialogShell>

    <ConfirmDialog
        :model-value="!!deleteTarget"
        :title="t('actions.confirm')"
        :message="t('leaderboard.seasons.deleteConfirm')"
        :loading="pending"
        @update:model-value="deleteTarget = null"
        @confirm="remove"
    />
</template>

<script setup lang="ts">
import { createSeason, deleteSeason, updateSeason } from '~/api/ticks'
import type { Form } from '@nuxt/ui'
import type { SeasonRecord } from '~/types/models'
import { formatDate } from '#shared/utils/formatting'
import { required, validateRules } from '~/utils/validation'

defineProps<{ seasons: SeasonRecord[] }>()
const emit = defineEmits<{ changed: [] }>()
const open = defineModel<boolean>({ default: false })

const { t, locale } = useI18n()
const gymId = useCurrentGymId()
const { pending, run } = useAsyncAction()

const form = useTemplateRef<Form<typeof draft>>('form')
const draft = reactive({ name: '', starts_at: '', ends_at: '' })
const editingId = ref<string | null>(null)
const deleteTarget = ref<SeasonRecord | null>(null)

const formatDay = (value: string) =>
    formatDate(value, { locale: locale.value, dateStyle: 'medium' })

const validate = (state: typeof draft) => {
    const errors = validateRules(state, {
        name: [required(t)],
        starts_at: [required(t)],
        ends_at: [required(t)],
    })
    if (state.starts_at && state.ends_at && state.ends_at <= state.starts_at)
        errors.push({
            name: 'ends_at',
            message: t('leaderboard.seasons.endBeforeStart'),
        })
    return errors
}

function reset() {
    Object.assign(draft, { name: '', starts_at: '', ends_at: '' })
    editingId.value = null
}

function edit(season: SeasonRecord) {
    Object.assign(draft, {
        name: season.name,
        starts_at: season.starts_at.slice(0, 10),
        ends_at: season.ends_at.slice(0, 10),
    })
    editingId.value = season.id
}

async function save() {
    const data = {
        name: draft.name.trim(),
        starts_at: `${draft.starts_at} 00:00:00.000Z`,
        ends_at: `${draft.ends_at} 00:00:00.000Z`,
    }
    const saved = await run(
        () =>
            editingId.value
                ? updateSeason(editingId.value, data)
                : createSeason(gymId.value, data),
        { success: t('notifications.success.edit') },
    )
    if (!saved) return
    reset()
    emit('changed')
}

async function remove() {
    const season = deleteTarget.value
    if (!season) return
    const deleted = await run(() => deleteSeason(season.id), {
        success: t('notifications.success.delete'),
    })
    if (!deleted) return
    deleteTarget.value = null
    if (editingId.value === season.id) reset()
    emit('changed')
}
</script>
