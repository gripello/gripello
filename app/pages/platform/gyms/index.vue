<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.gyms.title')">
            <template #actions>
                <UButton
                    color="primary"
                    icon="i-lucide-plus"
                    class="max-lg:fixed max-lg:right-4 max-lg:bottom-[calc(5rem+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:h-12 max-lg:shadow-lg"
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

        <template v-else>
            <div class="mb-4 flex flex-wrap items-center gap-3">
                <UInput
                    v-model="search"
                    icon="i-lucide-search"
                    :placeholder="t('platform.gyms.search')"
                    :aria-label="t('platform.gyms.search')"
                    size="lg"
                    class="min-w-48 flex-1 lg:max-w-sm"
                    data-testid="platform-gym-search"
                />
                <SegmentedControl
                    v-model="status"
                    :items="statusItems"
                    size="sm"
                    test-id="platform-gym-status"
                />
            </div>

            <UTable
                v-if="mdAndUp"
                :data="shownGyms"
                :columns="columns"
                :get-row-id="(row: PlatformGym) => row.id"
                :empty="t('table.no_data')"
                class="rounded-lg bg-default ring ring-default"
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
                v-else-if="!shownGyms.length"
                icon="i-lucide-building-2"
                :title="t('table.no_data')"
            />

            <LayoutListGroup v-else data-testid="platform-gym-list">
                <LayoutListRow
                    v-for="gym in shownGyms"
                    :key="gym.id"
                    :to="detailPath(gym)"
                    :data-testid="`platform-gym-link-${gym.slug}`"
                >
                    <PlatformGymIdentity :gym="gym" class="flex-1" />
                    <UBadge
                        v-if="openCases(gym.id)"
                        color="error"
                        variant="soft"
                        size="sm"
                        class="shrink-0"
                    >
                        {{ t('moderation.openCases', openCases(gym.id)) }}
                    </UBadge>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="size-5 shrink-0 text-dimmed"
                    />
                </LayoutListRow>
            </LayoutListGroup>
        </template>

        <PlatformRetiredSlugs class="mt-6" />

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
import { createGym as createGymRecord, updateGym } from '~/api/gyms'
import { findRole, inviteMember } from '~/api/members'
import type { Form, TableColumn } from '@nuxt/ui'
import type { GymRecord } from '~/types/models'
import { isValidGymSlug, slugifyGymName } from '#shared/utils/gymSlug'
import { formatDate } from '#shared/utils/formatting'
import {
    filterPlatformGyms,
    type PlatformGym,
    type PlatformGymStatus,
} from '~/utils/platformGyms'
import { required, validEmail, validateRules } from '~/utils/validation'
import { blockedFieldError } from '~/utils/fieldErrors'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, locale } = useI18n()

useHead({ title: () => t('platform.gyms.title') })

const { data: gyms, error, refresh } = await usePlatformGyms()
const { mdAndUp } = useDisplay()
const { summary } = useModerationSummary()

const search = ref('')
const status = ref<PlatformGymStatus>('all')
const statusItems = computed(() => {
    const active = gyms.value.filter((gym) => gym.active).length
    const hidden = filterPlatformGyms(gyms.value, '', 'hidden').length
    return [
        { value: 'all' as const, label: t('filter.all') },
        {
            value: 'active' as const,
            label: `${t('platform.gyms.active')} · ${active}`,
        },
        {
            value: 'hidden' as const,
            label: `${t('platform.gyms.invisible')} · ${hidden}`,
        },
        {
            value: 'offline' as const,
            label: `${t('platform.gyms.inactive')} · ${gyms.value.length - active}`,
        },
    ]
})
const shownGyms = computed(() =>
    filterPlatformGyms(gyms.value, search.value, status.value),
)

function openCases(gymId: string) {
    return summary.value?.gyms?.find((entry) => entry.gym === gymId)?.open ?? 0
}

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
    const adminRole = await findRole(gymId, 'admin')
    await inviteMember(gymId, {
        email: form.adminEmail.trim(),
        role: adminRole.id,
    })
}

async function createGym() {
    const gym = await runSave(() =>
        createGymRecord({
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
            error: (err) =>
                t(
                    blockedFieldError(err, ['email'])?.key ??
                        'platform.gyms.inviteFailed',
                ),
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
        await updateGym(gym.id, { active })
        gym.active = active
    })
}
</script>
