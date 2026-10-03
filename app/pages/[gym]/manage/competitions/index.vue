<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader :title="t('competitions.pageTitle')">
            <template #actions>
                <UButton
                    color="primary"
                    icon="i-lucide-plus"
                    data-testid="competitions-new"
                    @click="formOpen = true"
                >
                    {{ t('competitions.newTitle') }}
                </UButton>
            </template>
        </LayoutPageHeader>

        <LayoutLoadingState v-if="status === 'pending' && !competitions" />
        <LayoutEmptyState
            v-else-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
            data-testid="load-error"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    data-testid="load-error-retry"
                    @click="refresh()"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>
        <LayoutEmptyState
            v-else-if="!competitions?.length"
            icon="i-lucide-trophy"
            :title="t('competitions.empty')"
        />
        <ul v-else class="flex flex-col gap-3" data-testid="competitions-list">
            <li v-for="competition in competitions" :key="competition.id">
                <CompetitionCard
                    :competition="competition"
                    :to="gymPath(`/manage/competitions/${competition.id}`)"
                />
            </li>
        </ul>

        <CompetitionFormDialog v-model="formOpen" @saved="openCreated" />
    </div>
</template>

<script setup lang="ts">
import type { CompetitionRecord } from '~/types/models'

const gymPath = useGymPath()

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_competitions',
})

const { t } = useI18n()
const pb = usePocketbase()
const gymId = useCurrentGymId()

const formOpen = ref(false)

const {
    data: competitions,
    status,
    error,
    refresh,
} = await useAsyncData('manage-competitions', () =>
    pb.collection('competitions').getFullList<CompetitionRecord>({
        filter: gymFilter(pb, gymId.value),
        sort: '-starts_at',
    }),
)

useHead({ title: t('page.title.competitions') })

function openCreated(competition: CompetitionRecord) {
    return navigateTo(gymPath(`/manage/competitions/${competition.id}`))
}
</script>
