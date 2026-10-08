<template>
    <div class="grid grid-cols-12 gap-3">
        <div
            v-for="project in projects"
            :key="project.route"
            class="col-span-12 md:col-span-6 xl:col-span-4"
        >
            <div
                class="h-full rounded-lg bg-elevated p-4 flex flex-col gap-3"
                data-testid="logbook-project"
                :data-route-id="project.route"
            >
                <RouteSummary
                    :route="project.record"
                    :meta="`${$t('ticks.attemptCount', { count: project.attempts })} · ${$t('ticks.projects.lastTried', { date: formatDate(tickDate(project.lastTried), { locale }) })}`"
                />
                <div class="flex gap-2 justify-end mt-auto">
                    <UButton
                        :to="`/route?id=${project.route}`"
                        color="neutral"
                        variant="soft"
                        trailing-icon="i-lucide-chevron-right"
                    >
                        {{ $t('routes.view') }}
                    </UButton>
                    <UButton
                        color="primary"
                        variant="solid"
                        icon="i-lucide-circle-check"
                        data-testid="logbook-project-log"
                        @click="emit('log', project.route)"
                    >
                        {{ $t('ticks.projects.logSend') }}
                    </UButton>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { RouteRecord } from '~/types/models'
import type { OpenProject } from '#shared/utils/logbook'
import { formatDate } from '#shared/utils/formatting'
import { tickDate } from '#shared/utils/ticks'

defineProps<{
    projects: (OpenProject & { record?: RouteRecord })[]
}>()

const emit = defineEmits<{ log: [routeId: string] }>()

const { locale } = useI18n()
</script>
