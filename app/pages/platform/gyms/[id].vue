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
                        <template v-if="trial">
                            <UBadge
                                :color="trial.ended ? 'warning' : 'info'"
                                variant="soft"
                                data-testid="platform-gym-trial"
                            >
                                {{
                                    trial.ended
                                        ? t('trial.ended')
                                        : t('trial.until', {
                                              date: formatDate(trial.endsAt, {
                                                  locale,
                                              }),
                                          })
                                }}
                            </UBadge>
                            <UButton
                                color="neutral"
                                variant="outline"
                                icon="i-lucide-calendar-plus"
                                data-testid="platform-gym-trial-extend"
                                @click="setTrial(extendedTrialEnd(gym))"
                            >
                                {{ t('trial.extend') }}
                            </UButton>
                            <UButton
                                color="primary"
                                variant="soft"
                                icon="i-lucide-badge-check"
                                data-testid="platform-gym-trial-convert"
                                @click="convertDialogOpen = true"
                            >
                                {{ t('trial.convert') }}
                            </UButton>
                        </template>
                        <div
                            class="flex flex-wrap items-center gap-4 max-lg:order-last max-lg:w-full max-lg:rounded-lg max-lg:p-3 max-lg:ring max-lg:ring-default"
                        >
                            <USwitch
                                :model-value="!!gym.active"
                                :label="t('platform.gyms.active')"
                                data-testid="platform-gym-active"
                                @update:model-value="requestActive"
                            />
                            <USwitch
                                :model-value="!!gym.hidden"
                                :label="t('platform.gyms.invisible')"
                                :disabled="!gym.active"
                                data-testid="platform-gym-hidden"
                                @update:model-value="requestHidden"
                            />
                        </div>
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
                drill-down
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
                    <LayoutPanel :title="t('platform.features.title')">
                        <USwitch
                            v-for="flag in FEATURE_FLAGS"
                            :key="flag"
                            :model-value="hasFeature(gym, flag)"
                            :label="t(`platform.features.flags.${flag}`)"
                            :disabled="savingFeature"
                            :data-testid="`platform-feature-${gym.slug}-${flag}`"
                            @update:model-value="setFeature(flag, $event)"
                        />
                    </LayoutPanel>
                </template>
                <template #danger>
                    <LayoutPanel
                        :title="t('platform.gyms.delete')"
                        class="ring-error/40!"
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
                    </LayoutPanel>
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
                @confirm="setFlags({ active: false })"
            />

            <ConfirmDialog
                v-model="convertDialogOpen"
                :title="t('trial.convert')"
                :message="t('trial.convertConfirm', { name: gymTitle(gym) })"
                :confirm-text="t('trial.convert')"
                confirm-color="primary"
                data-testid="platform-gym-trial-convert-dialog"
                @confirm="setTrial(null)"
            />
            <ConfirmDialog
                v-model="hiddenDialogOpen"
                :title="t('platform.gyms.makeInvisible')"
                :message="
                    t('platform.gyms.makeInvisibleConfirm', {
                        name: gymTitle(gym),
                    })
                "
                :confirm-text="t('platform.gyms.makeInvisible')"
                data-testid="platform-gym-hidden-dialog"
                @confirm="setFlags({ hidden: true })"
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
import { gymTopic } from '#shared/utils/topics'
import { deleteGym as deleteGymRecord, getGymById, updateGym } from '~/api/gyms'
import type { FeatureFlag } from '#shared/utils/featureFlags'
import { FEATURE_FLAGS, hasFeature } from '#shared/utils/featureFlags'
import { setGymFeatures } from '~/api/platform'
import { gymTitle } from '~/utils/gymNames'
import { extendedTrialEnd, gymTrial } from '~/utils/gymTrial'
import { formatDate } from '#shared/utils/formatting'
import type { GymRecord } from '~/types/models'
import type { GymEvent } from '~/composables/useRealtime'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, locale } = useI18n()
const route = useRoute()
const gymId = String(route.params.id)
const membersCard = useTemplateRef<{ openInvite: () => void }>('membersCard')

const {
    data: gym,
    error,
    refresh,
} = await useAsyncData(`platform-gym-${gymId}`, () => getGymById(gymId))
useLiveRefresh(gymTopic(gymId), refresh, {
    when: (event: GymEvent) =>
        event.kind === 'gym.updated' || event.kind === 'gym.trial_changed',
})

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
        danger: true,
    },
])

const { run: runToggle } = useAsyncAction()
const offlineDialogOpen = ref(false)
const hiddenDialogOpen = ref(false)

function requestActive(active: boolean) {
    if (active) return setFlags({ active: true })
    offlineDialogOpen.value = true
}

function requestHidden(hidden: boolean) {
    if (!hidden) return setFlags({ hidden: false })
    hiddenDialogOpen.value = true
}

async function setFlags(flags: Partial<Pick<GymRecord, 'active' | 'hidden'>>) {
    offlineDialogOpen.value = false
    hiddenDialogOpen.value = false
    await runToggle(async () => {
        gym.value = await updateGym(gymId, flags)
    })
}

const hydrated = useHydrated()
const trial = computed(() => (hydrated.value ? gymTrial(gym.value) : null))
const convertDialogOpen = ref(false)

async function setTrial(trialEndsAt: string | null) {
    convertDialogOpen.value = false
    await runToggle(async () => {
        gym.value = await updateGym(gymId, { trial_ends_at: trialEndsAt })
    })
}

const { pending: savingFeature, run: runFeature } = useAsyncAction()

async function setFeature(flag: FeatureFlag, on: boolean) {
    await runFeature(async () => {
        gym.value = await setGymFeatures(gymId, {
            ...gym.value?.features,
            [flag]: on,
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
            await deleteGymRecord(gymId)
            deleteDialogOpen.value = false
            await navigateTo('/platform/gyms')
        },
        { success: t('platform.gyms.deleted') },
    )
}
</script>
