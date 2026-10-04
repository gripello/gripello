<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader :title="t('competitions.judge.title')" />
        <div class="flex flex-col gap-3" data-testid="judge-pick-competition">
            <LayoutEmptyState
                v-if="!judgeable?.length"
                icon="i-lucide-trophy"
                :title="t('competitions.judge.noCompetitions')"
            />
            <CompetitionCard
                v-for="item in judgeable"
                :key="item.id"
                :competition="item"
                :to="gymPath(`/manage/competitions/${item.id}/judge`)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
const gymPath = useGymPath()

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'judge_competitions',
})

const { t } = useI18n()

const { data: judgeable } = await useJudgeableCompetitions()

useHead({ title: t('page.title.judge') })
</script>
