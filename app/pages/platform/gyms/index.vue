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
            v-else-if="mdAndUp"
            :data="gyms"
            :columns="columns"
            :get-row-id="(row: PlatformGym) => row.id"
            :empty="t('table.no_data')"
            class="rounded-lg border border-default bg-default"
            :ui="{ tr: 'cursor-pointer' }"
            data-testid="platform-gym-table"
            @select="(_event, row) => navigateTo(detailPath(row.original))"
        >
            <template #venue-cell="{ row }">
                <ULink
                    :to="detailPath(row.original)"
                    class="block max-w-80 min-w-0"
                    :data-testid="`platform-gym-link-${row.original.slug}`"
                >
                    <PlatformGymIdentity :gym="row.original" />
                </ULink>
            </template>
            <template #members-cell="{ row }">
                <span class="tabular-nums">{{ row.original.members }}</span>
            </template>
            <template #routes-cell="{ row }">
                <span class="tabular-nums">{{ row.original.routes }}</span>
            </template>
            <template #active-cell="{ row }">
                <USwitch
                    :model-value="!!row.original.active"
                    :aria-label="t('platform.gyms.active')"
                    :data-testid="`platform-gym-active-${row.original.slug}`"
                    @update:model-value="
                        (active) => requestActive(row.original, active)
                    "
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
            <template #edit-cell="{ row }">
                <div class="flex justify-end">
                    <UButton
                        v-if="row.original.active"
                        :to="`/${row.original.slug}`"
                        icon="i-lucide-external-link"
                        variant="ghost"
                        color="neutral"
                        class="icon-btn"
                        :aria-label="t('platform.gyms.open')"
                        :data-testid="`platform-gym-open-${row.original.slug}`"
                        @click.stop
                    />
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
                </div>
            </template>
        </UTable>

        <LayoutEmptyState
            v-else-if="!gyms.length"
            icon="i-lucide-building-2"
            :title="t('table.no_data')"
        />

        <ul
            v-else
            class="divide-y divide-default rounded-lg border border-default bg-default"
            data-testid="platform-gym-list"
        >
            <li
                v-for="gym in gyms"
                :key="gym.id"
                class="flex items-center gap-2 p-3"
            >
                <ULink
                    :to="detailPath(gym)"
                    class="min-w-0 flex-1"
                    :data-testid="`platform-gym-link-${gym.slug}`"
                >
                    <PlatformGymIdentity :gym="gym" />
                </ULink>
                <USwitch
                    :model-value="!!gym.active"
                    :aria-label="t('platform.gyms.active')"
                    :data-testid="`platform-gym-active-${gym.slug}`"
                    @update:model-value="(active) => requestActive(gym, active)"
                />
                <UButton
                    :to="detailPath(gym)"
                    icon="i-lucide-pencil"
                    variant="ghost"
                    color="neutral"
                    class="icon-btn"
                    :aria-label="t('actions.edit')"
                    :data-testid="`platform-gym-edit-${gym.slug}`"
                />
            </li>
        </ul>

        <ConfirmDialog
            :model-value="!!offlineTarget"
            :title="t('platform.gyms.takeOffline')"
            :message="
                t('platform.gyms.takeOfflineConfirm', {
                    name: offlineTarget?.name ?? '',
                })
            "
            :confirm-text="t('platform.gyms.takeOffline')"
            data-testid="platform-gym-offline-dialog"
            @update:model-value="offlineTarget = null"
            @confirm="offlineTarget && setActive(offlineTarget, false)"
        />

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
import type { PlatformGym } from '~/utils/platformGyms'
import { required, validEmail, validateRules } from '~/utils/validation'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, locale } = useI18n()
const pb = usePocketbase()

useHead({ title: () => t('platform.gyms.title') })

const { data: gyms, error, refresh } = await usePlatformGyms()
const { mdAndUp } = useDisplay()

const detailPath = (gym: GymRecord) => `/platform/gyms/${gym.id}`

const numeric = { class: { th: 'w-24', td: 'w-24' } }
const wideOnly = {
    class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' },
}

const columns = computed<TableColumn<PlatformGym>[]>(() => [
    { id: 'venue', header: t('platform.gyms.venue') },
    { id: 'members', header: t('members.title'), meta: numeric },
    { id: 'routes', header: t('platform.overview.routes'), meta: numeric },
    { id: 'active', header: t('platform.gyms.active'), meta: numeric },
    { id: 'created', header: t('platform.gyms.createdAt'), meta: wideOnly },
    { id: 'edit', header: '', meta: { class: { td: 'w-28' } } },
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

const offlineTarget = ref<GymRecord | null>(null)

function requestActive(gym: GymRecord, active: boolean) {
    if (active) return setActive(gym, true)
    offlineTarget.value = gym
}

async function setActive(gym: GymRecord, active: boolean) {
    offlineTarget.value = null
    await runToggle(async () => {
        await pb.collection('gyms').update(gym.id, { active })
        gym.active = active
    })
}
</script>
