<template>
    <UPageCard
        :title="$t('settings.locations')"
        :description="$t('settings.locationsIntro')"
        variant="subtle"
        data-testid="settings-locations"
    >
        <div class="location-list">
            <div
                v-for="location in locations"
                :key="location.id"
                class="location-row"
                data-testid="settings-location"
                :data-name="location.name"
            >
                <UInput
                    :model-value="draftNames[location.id] ?? location.name"
                    :aria-label="$t('settings.locationName')"
                    :placeholder="$t('settings.locationName')"
                    icon="i-lucide-map-pin"
                    :maxlength="100"
                    class="flex-1"
                    data-testid="settings-location-name"
                    @update:model-value="draftNames[location.id] = $event"
                    @blur="rename(location)"
                    @keydown.enter="rename(location)"
                />
                <UButton
                    icon="i-lucide-trash-2"
                    variant="ghost"
                    color="error"
                    :loading="busyId === location.id"
                    :aria-label="$t('settings.locationDelete')"
                    :title="$t('settings.locationDelete')"
                    data-testid="settings-location-delete"
                    @click="remove(location)"
                />
            </div>
        </div>

        <form class="location-row" @submit.prevent="add">
            <UInput
                v-model="newName"
                :aria-label="$t('settings.locationNew')"
                :placeholder="$t('settings.locationNew')"
                icon="i-lucide-map-pin-plus"
                :maxlength="100"
                class="flex-1"
                data-testid="settings-location-new"
            />
            <UButton
                type="submit"
                color="neutral"
                variant="soft"
                :disabled="!newName.trim()"
                :loading="busyId === 'new'"
                data-testid="settings-location-add"
            >
                {{ $t('settings.locationAdd') }}
            </UButton>
        </form>
    </UPageCard>
</template>

<script setup lang="ts">
import type { LocationRecord } from '~/types/models'

const pb = usePocketbase()
const gymId = useCurrentGymId()
const { t } = useI18n()
const { run: runAction } = useAsyncAction()
const { data: locations, refresh } = useLocations()

const newName = ref('')
const busyId = ref<string | null>(null)
const draftNames = reactive<Record<string, string>>({})

watch(
    locations,
    (records) => {
        for (const record of records) draftNames[record.id] = record.name
    },
    { immediate: true },
)

async function run(id: string, action: () => Promise<unknown>) {
    busyId.value = id
    const saved = await runAction(
        async () => {
            await action()
            await refresh()
            return true
        },
        {
            success: t('settings.locationSaved'),
            error: (error) =>
                t(
                    (error as { status?: number }).status === 400
                        ? 'settings.locationSaveFailed'
                        : 'notifications.error.generic',
                ),
        },
    )
    busyId.value = null
    return saved ?? false
}

async function add() {
    const name = newName.value.trim()
    if (!name) return
    if (
        await run('new', () =>
            pb.collection('locations').create({ name, gym: gymId.value }),
        )
    ) {
        newName.value = ''
    }
}

async function rename(location: LocationRecord) {
    const name = draftNames[location.id]?.trim() ?? ''
    if (!name || name === location.name) {
        draftNames[location.id] = location.name
        return
    }
    const saved = await run(location.id, () =>
        pb.collection('locations').update(location.id, { name }),
    )
    if (!saved) draftNames[location.id] = location.name
}

function remove(location: LocationRecord) {
    return run(location.id, () =>
        pb.collection('locations').delete(location.id),
    )
}
</script>

<style scoped>
.location-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.location-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
</style>
