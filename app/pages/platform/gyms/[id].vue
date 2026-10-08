<template>
    <div class="w-full p-4">
        <LayoutEmptyState
            v-if="error || !gym"
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
            <div class="[&_header_p]:font-mono">
                <LayoutPageHeader
                    :title="gymTitle(gym)"
                    :subtitle="`/${gym.slug}`"
                    back-to="/platform/gyms"
                    :back-label="t('platform.gyms.title')"
                >
                    <template #actions>
                        <USwitch
                            :model-value="!!gym.active"
                            :label="t('platform.gyms.active')"
                            data-testid="platform-gym-active"
                            @update:model-value="requestActive"
                        />
                        <UButton
                            :to="`/platform/moderation?gym=${gym.id}`"
                            color="neutral"
                            variant="outline"
                            icon="i-lucide-shield-alert"
                            data-testid="platform-gym-moderation"
                        >
                            {{ t('moderation.title') }}
                            <UBadge
                                v-if="openCases"
                                color="error"
                                variant="soft"
                                size="sm"
                            >
                                {{ openCases }}
                            </UBadge>
                        </UButton>
                        <UButton
                            v-if="gym.active"
                            :to="`/${gym.slug}`"
                            color="neutral"
                            variant="outline"
                            icon="i-lucide-external-link"
                            data-testid="platform-gym-open"
                        >
                            {{ t('platform.gyms.open') }}
                        </UButton>
                    </template>
                </LayoutPageHeader>
            </div>

            <AdminGymSettingsForm
                :gym="gym"
                edit-slug
                :extra-sections="extraSections"
                @saved="gym = $event"
            >
                <template #members>
                    <section>
                        <LayoutSectionHeader :title="t('members.title')">
                            <template #actions>
                                <UButton
                                    color="primary"
                                    icon="i-lucide-user-plus"
                                    data-testid="member-invite-open"
                                    @click="membersCard?.openInvite()"
                                >
                                    {{ t('members.invite') }}
                                </UButton>
                            </template>
                        </LayoutSectionHeader>
                        <AdminMembersCard ref="membersCard" :gym-id="gym.id" />
                    </section>
                </template>
                <template #features>
                    <UPageCard
                        :title="t('platform.features.title')"
                        variant="outline"
                    >
                        <USwitch
                            v-for="flag in FEATURE_FLAGS"
                            :key="flag"
                            :model-value="hasFeature(gym, flag)"
                            :label="t(`platform.features.flags.${flag}`)"
                            :disabled="savingFeature"
                            :data-testid="`platform-feature-${gym.slug}-${flag}`"
                            @update:model-value="setFeature(flag, $event)"
                        />
                    </UPageCard>
                </template>
                <template #danger>
                    <UPageCard
                        :title="t('platform.gyms.delete')"
                        variant="outline"
                        class="ring-error/40"
                    >
                        <div>
                            <UButton
                                color="error"
                                icon="i-lucide-trash-2"
                                data-testid="platform-gym-delete"
                                @click="deleteDialogOpen = true"
                            >
                                {{ t('platform.gyms.delete') }}
                            </UButton>
                        </div>
                    </UPageCard>
                </template>
            </AdminGymSettingsForm>

            <ConfirmDialog
                v-model="offlineDialogOpen"
                :title="t('platform.gyms.takeOffline')"
                :message="
                    t('platform.gyms.takeOfflineConfirm', {
                        name: gymTitle(gym),
                    })
                "
                :confirm-text="t('platform.gyms.takeOffline')"
                data-testid="platform-gym-offline-dialog"
                @confirm="setActive(false)"
            />

            <ConfirmDialog
                v-model="deleteDialogOpen"
                :title="t('platform.gyms.delete')"
                :message="
                    t('platform.gyms.deleteConfirm', { name: gymTitle(gym) })
                "
                :loading="removing"
                @confirm="deleteGym"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
import type { GymRecord } from '~/types/models'
import type { FeatureFlag } from '#shared/utils/featureFlags'
import { FEATURE_FLAGS, hasFeature } from '#shared/utils/featureFlags'
import { gymTitle } from '~/utils/gymNames'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t } = useI18n()
const pb = usePocketbase()
const route = useRoute()
const gymId = String(route.params.id)
const membersCard = useTemplateRef<{ openInvite: () => void }>('membersCard')

const {
    data: gym,
    error,
    refresh,
} = await useAsyncData(`platform-gym-${gymId}`, () =>
    pb.collection('gyms').getOne<GymRecord>(gymId, { requestKey: null }),
)

useHead({
    title: () => (gym.value ? gymTitle(gym.value) : t('platform.gyms.title')),
})

const extraSections = computed(() => [
    { id: 'members', label: t('members.title'), icon: 'i-lucide-users-round' },
    {
        id: 'features',
        label: t('platform.features.title'),
        icon: 'i-lucide-flag',
    },
    {
        id: 'danger',
        label: t('platform.gyms.delete'),
        icon: 'i-lucide-trash-2',
    },
])

const { run: runToggle } = useAsyncAction()
const offlineDialogOpen = ref(false)

function requestActive(active: boolean) {
    if (active) return setActive(true)
    offlineDialogOpen.value = true
}

async function setActive(active: boolean) {
    offlineDialogOpen.value = false
    await runToggle(async () => {
        gym.value = await pb
            .collection('gyms')
            .update<GymRecord>(gymId, { active })
    })
}

const { pending: savingFeature, run: runFeature } = useAsyncAction()

async function setFeature(flag: FeatureFlag, on: boolean) {
    await runFeature(async () => {
        gym.value = await pb.collection('gyms').update<GymRecord>(gymId, {
            features: { ...gym.value?.features, [flag]: on },
        })
    })
}

const { summary } = useModerationSummary()
const openCases = computed(
    () => summary.value?.gyms?.find((entry) => entry.gym === gymId)?.open ?? 0,
)

const deleteDialogOpen = ref(false)
const { pending: removing, run: runRemove } = useAsyncAction()

async function deleteGym() {
    await runRemove(
        async () => {
            await pb.collection('gyms').delete(gymId)
            deleteDialogOpen.value = false
            await navigateTo('/platform/gyms')
        },
        { success: t('platform.gyms.deleted') },
    )
}
</script>
