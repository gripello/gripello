<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.backups.title')">
            <template v-if="data?.enabled" #actions>
                <UButton
                    color="primary"
                    icon="i-lucide-archive"
                    :loading="data.running || starting"
                    :disabled="data.pg_dump === false"
                    data-testid="platform-backups-run"
                    @click="startBackup"
                >
                    {{
                        data.running
                            ? t('platform.backups.running')
                            : t('platform.backups.runNow')
                    }}
                </UButton>
            </template>
        </LayoutPageHeader>

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        />
        <LayoutEmptyState
            v-else-if="data && !data.enabled"
            icon="i-lucide-archive-x"
            :title="t('platform.backups.disabled')"
            data-testid="platform-backups-disabled"
        />
        <template v-else-if="data">
            <UAlert
                v-if="data.pg_dump === false"
                color="error"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                :title="t('platform.backups.pgDumpMissing')"
                class="mb-3"
                data-testid="platform-backups-pg-dump-missing"
            />
            <UAlert
                v-else-if="data.last_error && !data.running"
                color="error"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                :title="lastFailedTitle"
                :description="data.last_error"
                :ui="{ description: 'font-mono text-xs break-all' }"
                :actions="[
                    {
                        label: t('platform.backups.retry'),
                        color: 'error',
                        variant: 'outline',
                        onClick: startBackup,
                    },
                ]"
                class="mb-3"
                data-testid="platform-backups-last-error"
            />
            <UAlert
                v-if="data.running"
                color="primary"
                variant="subtle"
                icon="i-lucide-loader-circle"
                :title="t('platform.backups.running')"
                :ui="{ icon: 'animate-spin' }"
                class="mb-3"
                data-testid="platform-backups-progress"
            />

            <div
                class="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4"
                data-testid="platform-backups-status"
            >
                <div
                    v-for="tile in statusTiles"
                    :key="tile.key"
                    class="flex flex-col gap-1 rounded-lg bg-default p-4 ring ring-default"
                    :data-testid="`platform-backups-tile-${tile.key}`"
                >
                    <span class="text-sm text-muted">{{ tile.label }}</span>
                    <span
                        class="text-xl font-bold text-highlighted"
                        :class="tile.tone"
                    >
                        {{ tile.value }}
                    </span>
                    <span class="text-xs text-muted">{{ tile.detail }}</span>
                    <UProgress
                        v-if="tile.meter !== undefined"
                        :model-value="tile.meter"
                        size="xs"
                        class="mt-1"
                    />
                </div>
            </div>

            <div
                class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]"
            >
                <LayoutPanel
                    :title="t('platform.backups.archives')"
                    class="flex flex-col"
                >
                    <template v-if="sizeTrend.length > 1" #actions>
                        <div
                            class="flex h-6 items-end gap-0.5"
                            aria-hidden="true"
                        >
                            <span
                                v-for="(height, index) in sizeTrend"
                                :key="index"
                                class="w-2 rounded-sm bg-primary/50 last:bg-primary"
                                :style="{ height: `${height}%` }"
                            />
                        </div>
                    </template>
                    <LayoutEmptyState
                        v-if="!data.items.length"
                        icon="i-lucide-archive"
                        :title="t('platform.backups.empty')"
                        :card="false"
                        class="flex flex-1 flex-col items-center justify-center"
                    />
                    <ul
                        v-else
                        class="-mx-4 -mb-4 divide-y divide-default"
                        data-testid="platform-backups-list"
                    >
                        <li
                            v-for="archive in data.items"
                            :key="archive.name"
                            class="flex min-h-14 items-center gap-3 px-4 py-2"
                            :data-testid="`platform-backup-${archive.name}`"
                        >
                            <UIcon
                                name="i-lucide-archive"
                                class="size-5 shrink-0 text-muted"
                            />
                            <div class="min-w-0 flex-1">
                                <div class="truncate font-medium">
                                    {{
                                        formatDate(archive.created, {
                                            locale,
                                            withTime: true,
                                        })
                                    }}
                                </div>
                                <div
                                    class="truncate font-mono text-xs text-muted"
                                >
                                    {{ archive.name }}
                                </div>
                            </div>
                            <span class="shrink-0 text-sm tabular-nums">
                                {{ formatBytes(archive.size, locale) }}
                            </span>
                            <UButton
                                icon="i-lucide-download"
                                color="neutral"
                                variant="outline"
                                class="icon-btn"
                                :aria-label="t('platform.backups.download')"
                                :data-testid="`platform-backup-download-${archive.name}`"
                                @click="request({ kind: 'download', archive })"
                            />
                            <UButton
                                icon="i-lucide-trash-2"
                                color="error"
                                variant="ghost"
                                class="icon-btn"
                                :aria-label="t('platform.backups.delete')"
                                :data-testid="`platform-backup-delete-${archive.name}`"
                                @click="request({ kind: 'delete', archive })"
                            />
                        </li>
                    </ul>
                </LayoutPanel>

                <div class="flex min-w-0 flex-col gap-3">
                    <LayoutPanel :title="t('platform.backups.schedule')">
                        <template #actions>
                            <USwitch
                                :model-value="form.keep > 0"
                                :aria-label="t('platform.backups.daily')"
                                data-testid="platform-backups-enabled"
                                @update:model-value="
                                    (on: boolean) =>
                                        (form.keep = on
                                            ? data?.settings?.keep || 7
                                            : 0)
                                "
                            />
                        </template>
                        <UFormField
                            :label="`${t('platform.backups.time')} (${zoneLabel})`"
                        >
                            <USelect
                                v-model="form.hour"
                                :items="hourOptions"
                                :disabled="form.keep === 0"
                                class="w-full"
                                data-testid="platform-backups-hour"
                            />
                        </UFormField>
                        <UFormField :label="t('platform.backups.keepCount')">
                            <UInputNumber
                                v-model="form.keep"
                                :min="0"
                                :max="365"
                                class="w-full"
                                data-testid="platform-backups-keep"
                            />
                        </UFormField>
                        <span
                            v-if="averageSize && form.keep"
                            class="text-xs text-muted"
                        >
                            {{
                                t('platform.backups.estimate', {
                                    size: formatBytes(
                                        averageSize * form.keep,
                                        locale,
                                    ),
                                })
                            }}
                        </span>
                        <USwitch
                            v-model="form.include_storage"
                            :label="t('platform.backups.includeStorage')"
                            data-testid="platform-backups-include-storage"
                        />
                        <div>
                            <UButton
                                color="primary"
                                :disabled="!settingsChanged"
                                data-testid="platform-backups-save"
                                @click="request({ kind: 'settings' })"
                            >
                                {{ t('actions.save') }}
                            </UButton>
                        </div>
                    </LayoutPanel>

                    <LayoutPanel :title="t('platform.backups.restore')">
                        <div
                            class="flex items-start gap-2 rounded-md bg-muted p-3 ring ring-default"
                        >
                            <code
                                class="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre text-highlighted"
                                >{{ restoreCommand }}</code
                            >
                            <UButton
                                icon="i-lucide-copy"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="t('platform.backups.copyCommand')"
                                data-testid="platform-backups-copy-restore"
                                @click="copyRestore"
                            />
                        </div>
                    </LayoutPanel>
                </div>
            </div>
        </template>

        <ConfirmDialog
            :model-value="!!pending"
            :title="pending ? dialogTitle(pending) : ''"
            :message="t('platform.backups.confirm')"
            :confirm-text="pending ? dialogTitle(pending) : ''"
            :confirm-color="pending?.kind === 'delete' ? 'error' : 'primary'"
            :loading="busy"
            @update:model-value="(open: boolean) => !open && (pending = null)"
            @confirm="confirm"
        >
            <UserPasswordField
                v-model="adminPassword"
                :label="t('platform.users.adminPassword')"
                icon="i-lucide-shield-check"
                class="mt-3"
                data-testid="platform-backups-admin-password"
            />
        </ConfirmDialog>
    </div>
</template>

<script setup lang="ts">
import { CLIENT_ONLY } from '~/utils/platformMail'
import { copyText } from '~/utils/clipboard'
import { formatDate } from '#shared/utils/formatting'
import { reauthenticate } from '~/api/account'
import {
    backupDownloadUrl,
    deleteBackup,
    listBackups,
    runBackup,
    saveBackupSettings,
    type BackupArchive,
} from '~/api/backups'
import {
    backupHourOptions,
    formatBytes,
    nextBackupRun,
    timeZoneName,
    syncCleanForm,
} from '~/utils/backups'
import { isWrongPassword } from '~/utils/reauth'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, locale } = useI18n()
const { success: notifySuccess, error: notifyError } = useNotification()

useHead({ title: () => t('platform.backups.title') })

const { data, error, refresh } = await useAsyncData(
    'platform-backups',
    listBackups,
    CLIENT_ONLY,
)

const form = reactive({ keep: 7, include_storage: true, hour: 2 })
const hydrated = useHydrated()
// The server renders in UTC; the viewer's zone only exists in the browser.
const viewerZone = computed(() => (hydrated.value ? undefined : 'UTC'))
const zoneLabel = computed(() => timeZoneName(locale.value, viewerZone.value))
const hourOptions = computed(() =>
    backupHourOptions(locale.value, viewerZone.value),
)
watch(
    () => data.value?.settings,
    (settings, previous) => syncCleanForm(form, settings, previous),
    { immediate: true },
)
const settingsChanged = computed(
    () =>
        !!data.value?.settings &&
        (form.keep !== data.value.settings.keep ||
            form.include_storage !== data.value.settings.include_storage ||
            form.hour !== data.value.settings.hour),
)

const averageSize = computed(() => {
    const items = data.value?.items ?? []
    return items.length
        ? items.reduce((sum, item) => sum + item.size, 0) / items.length
        : 0
})

const sizeTrend = computed(() => {
    const sizes = (data.value?.items ?? [])
        .slice(0, 14)
        .map((i) => i.size)
        .reverse()
    const largest = Math.max(1, ...sizes)
    return sizes.map((size) => Math.max(8, (size / largest) * 100))
})

const lastFailedTitle = computed(() =>
    data.value?.last_run
        ? `${t('platform.backups.lastFailed')} · ${formatDate(data.value.last_run, { locale: locale.value, withTime: true })}`
        : t('platform.backups.lastFailed'),
)

const statusTiles = computed(() => {
    const value = data.value
    if (!value) return []
    const latest = value.items[0]
    const totalSize = value.items.reduce((sum, item) => sum + item.size, 0)
    const settings = value.settings
    const scheduled = !!settings && settings.keep > 0
    const tiles: Array<{
        key: string
        label: string
        value: string
        detail: string
        tone?: string
        meter?: number
    }> = [
        {
            key: 'last',
            label: t('platform.backups.lastBackup'),
            value: value.last_error
                ? t('platform.backups.failed')
                : latest
                  ? formatDate(latest.created, {
                        locale: locale.value,
                        withTime: true,
                    })
                  : '—',
            detail: latest ? formatBytes(latest.size, locale.value) : '',
            tone: value.last_error ? 'text-error' : undefined,
        },
        {
            key: 'next',
            label: t('platform.backups.nextBackup'),
            value: scheduled
                ? formatDate(nextBackupRun(settings.hour).toISOString(), {
                      locale: locale.value,
                      withTime: true,
                  })
                : t('platform.backups.off'),
            detail: scheduled ? '' : t('platform.backups.manualOnly'),
        },
        {
            key: 'archives',
            label: t('platform.backups.archives'),
            value: settings?.keep
                ? `${value.items.length} / ${settings.keep}`
                : String(value.items.length),
            detail: formatBytes(totalSize, locale.value),
        },
    ]
    if (value.disk_total && value.disk_free !== undefined) {
        tiles.push({
            key: 'disk',
            label: t('platform.backups.freeSpace'),
            value: formatBytes(value.disk_free, locale.value),
            detail: formatBytes(value.disk_total, locale.value),
            meter: Math.round((1 - value.disk_free / value.disk_total) * 100),
        })
    }
    return tiles
})

const restoreCommand = computed(() => {
    const latest = data.value?.items[0]?.name ?? 'gripello-YYYYMMDD-HHMMSS.tar'
    const dir = (data.value?.dir || '/data/backups').replace(/\/$/, '')
    return `docker compose exec gripello gripello admin restore --file ${dir}/${latest} --storage --yes`
})

async function copyRestore() {
    if (await copyText(restoreCommand.value))
        notifySuccess(t('platform.logs.copied'))
    else notifyError(t('notifications.error.generic'))
}

let poll: ReturnType<typeof setInterval> | undefined
watch(
    () => data.value?.running,
    (running) => {
        clearInterval(poll)
        if (running && import.meta.client)
            poll = setInterval(() => refresh(), 5000)
    },
    { immediate: true },
)
onBeforeUnmount(() => clearInterval(poll))
usePlatformLive(['backup.created', 'backup.deleted', 'backup.updated'], refresh)

const { pending: starting, run: runStart } = useAsyncAction()

async function startBackup() {
    await runStart(async () => {
        await runBackup()
        await refresh()
    })
}

type PendingAction =
    | { kind: 'download' | 'delete'; archive: BackupArchive }
    | { kind: 'settings' }

const pending = ref<PendingAction | null>(null)
const adminPassword = ref('')

function request(action: PendingAction) {
    adminPassword.value = ''
    pending.value = action
}

function dialogTitle(action: PendingAction) {
    return t(`platform.backups.${action.kind}`)
}

const { pending: busy, run } = useAsyncAction()

async function confirm() {
    const action = pending.value
    if (!action || !adminPassword.value) return
    await run(
        async () => {
            await reauthenticate(adminPassword.value)
            if (action.kind === 'download') {
                window.location.assign(backupDownloadUrl(action.archive.name))
            } else if (action.kind === 'delete') {
                await deleteBackup(action.archive.name)
                await refresh()
            } else {
                await saveBackupSettings({ ...form })
                await refresh()
            }
            pending.value = null
        },
        {
            error: (err) =>
                isWrongPassword(err)
                    ? t('platform.users.adminPasswordWrong')
                    : t('notifications.error.generic'),
        },
    )
}
</script>
