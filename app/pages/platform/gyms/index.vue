<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.gyms.title')">
            <template #actions>
                <UButton
                    color="primary"
                    icon="i-lucide-plus"
                    data-testid="platform-gym-create"
                    @click="openCreate"
                >
                    {{ t('platform.gyms.create') }}
                </UButton>
            </template>
        </LayoutPageHeader>

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    @click="refresh()"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <UTable
            v-else
            :data="gyms"
            :columns="columns"
            :get-row-id="(row: GymRecord) => row.id"
            :empty="t('table.no_data')"
            class="rounded-lg border border-default bg-default"
            :ui="{ root: 'overflow-x-auto', tr: 'cursor-pointer' }"
            data-testid="platform-gym-table"
            @select="(_event, row) => navigateTo(detailPath(row.original))"
        >
            <template #venue-cell="{ row }">
                <ULink
                    :to="detailPath(row.original)"
                    class="block max-w-[55vw] min-w-0 md:max-w-64"
                    :data-testid="`platform-gym-link-${row.original.slug}`"
                >
                    <span class="block truncate font-semibold text-highlighted">
                        {{ gymTitle(row.original) }}
                    </span>
                    <span
                        v-if="gymSubtitle(row.original)"
                        class="block truncate text-sm text-muted"
                    >
                        {{ gymSubtitle(row.original) }}
                    </span>
                    <span
                        class="block truncate font-mono text-xs text-muted md:hidden"
                    >
                        /{{ row.original.slug }}
                    </span>
                </ULink>
            </template>
            <template #slug-cell="{ row }">
                <span class="font-mono text-sm">/{{ row.original.slug }}</span>
            </template>
            <template #active-cell="{ row }">
                <USwitch
                    :model-value="!!row.original.active"
                    :aria-label="t('platform.gyms.active')"
                    :data-testid="`platform-gym-active-${row.original.slug}`"
                    @update:model-value="
                        (active) => setActive(row.original, active)
                    "
                />
            </template>
            <template #edit-cell="{ row }">
                <UButton
                    :to="detailPath(row.original)"
                    icon="i-lucide-pencil"
                    variant="ghost"
                    color="neutral"
                    class="icon-btn"
                    :aria-label="t('actions.edit')"
                    :data-testid="`platform-gym-edit-${row.original.slug}`"
                    @click.stop
                />
            </template>
            <template #created-cell="{ row }">
                <span class="text-muted">
                    {{
                        formatDate(row.original.created, {
                            locale,
                            timeZone: 'UTC',
                        })
                    }}
                </span>
            </template>
        </UTable>

        <LayoutDialogShell
            v-model="dialogOpen"
            :title="t('platform.gyms.create')"
            sheet-on-mobile
            closable
            data-testid="platform-gym-dialog"
        >
            <UForm
                ref="gymForm"
                :state="form"
                :validate="validateGym"
                @submit="createGym"
            >
                <UFormField
                    :label="t('platform.gyms.name')"
                    name="name"
                    class="mb-4"
                >
                    <UInput
                        v-model="form.name"
                        class="w-full"
                        data-testid="platform-gym-name"
                        @update:model-value="syncSlug"
                    />
                </UFormField>
                <UFormField
                    :label="t('platform.gyms.slug')"
                    name="slug"
                    class="mb-4"
                >
                    <UInput
                        v-model="form.slug"
                        class="w-full"
                        :ui="{ base: 'font-mono' }"
                        data-testid="platform-gym-slug"
                        @update:model-value="slugEdited = true"
                    />
                </UFormField>
                <UFormField
                    :label="t('platform.gyms.adminEmail')"
                    name="adminEmail"
                >
                    <UInput
                        v-model="form.adminEmail"
                        type="email"
                        autocomplete="off"
                        class="w-full"
                        data-testid="platform-gym-admin-email"
                    />
                </UFormField>
            </UForm>
            <template #actions>
                <UButton
                    color="neutral"
                    variant="ghost"
                    data-testid="platform-gym-cancel"
                    @click="dialogOpen = false"
                >
                    {{ t('actions.cancel') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    color="primary"
                    :loading="saving"
                    data-testid="platform-gym-submit"
                    @click="gymForm?.submit()"
                >
                    {{ t('actions.save') }}
                </UButton>
            </template>
        </LayoutDialogShell>
    </div>
</template>

<script setup lang="ts">
import type { Form, TableColumn } from '@nuxt/ui'
import type { GymRecord, RoleRecord } from '~/types/models'
import { isValidGymSlug, slugifyGymName } from '#shared/utils/gymSlug'
import { formatDate } from '#shared/utils/formatting'
import { gymSubtitle, gymTitle } from '~/utils/gymNames'
import { required, validEmail, validateRules } from '~/utils/validation'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, locale } = useI18n()
const pb = usePocketbase()

useHead({ title: () => t('platform.gyms.title') })

const {
    data: gyms,
    error,
    refresh,
} = await useAsyncData(
    'platform-gyms',
    () =>
        pb.collection('gyms').getFullList<GymRecord>({
            fields: 'id,slug,name,unit_name,active,created',
            sort: 'name',
            requestKey: null,
        }),
    { default: () => [] },
)

const detailPath = (gym: GymRecord) => `/platform/gyms/${gym.id}`

const wideOnly = {
    class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell' },
}

const columns = computed<TableColumn<GymRecord>[]>(() => [
    { id: 'venue', header: t('platform.gyms.venue') },
    { id: 'slug', header: t('platform.gyms.slug'), meta: wideOnly },
    { id: 'active', header: t('platform.gyms.active') },
    { id: 'created', header: t('platform.gyms.createdAt'), meta: wideOnly },
    { id: 'edit', header: '', meta: { class: { td: 'w-12 text-end' } } },
])

const dialogOpen = ref(false)
const slugEdited = ref(false)
const form = reactive({ name: '', slug: '', adminEmail: '' })
const gymForm = ref<Form<typeof form> | null>(null)
const { pending: saving, run: runSave } = useAsyncAction()

function validateGym(state: typeof form) {
    return validateRules(state, {
        name: [required(t)],
        slug: [
            required(t),
            (slug) =>
                isValidGymSlug(String(slug)) || t('platform.gyms.invalidSlug'),
        ],
        adminEmail: [required(t), validEmail(t)],
    })
}

function openCreate() {
    slugEdited.value = false
    Object.assign(form, { name: '', slug: '', adminEmail: '' })
    dialogOpen.value = true
}

function syncSlug() {
    if (!slugEdited.value) form.slug = slugifyGymName(form.name)
}

async function inviteFirstAdmin(gymId: string) {
    const adminRole = await pb
        .collection('roles')
        .getFirstListItem<RoleRecord>(
            pb.filter('gym = {:gym} && name = "admin"', { gym: gymId }),
            { requestKey: null },
        )
    await pb.send(`/api/gyms/${gymId}/members`, {
        method: 'POST',
        body: { email: form.adminEmail.trim(), role: adminRole.id },
        requestKey: null,
    })
}

async function createGym() {
    const gym = await runSave(() =>
        pb.collection('gyms').create<GymRecord>({
            name: form.name.trim(),
            slug: form.slug,
            active: true,
        }),
    )
    if (!gym) return
    dialogOpen.value = false
    await refresh()
    const invited = await runSave(
        async () => {
            await inviteFirstAdmin(gym.id)
            return true
        },
        {
            success: t('platform.gyms.created'),
            error: t('platform.gyms.inviteFailed'),
        },
    )
    if (!invited) await navigateTo(detailPath(gym))
}

const { run: runToggle } = useAsyncAction()

async function setActive(gym: GymRecord, active: boolean) {
    await runToggle(async () => {
        await pb.collection('gyms').update(gym.id, { active })
        gym.active = active
    })
}
</script>
