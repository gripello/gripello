<template>
    <div class="flex flex-col gap-3" data-testid="competition-routes">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
            <UFormField :label="$t(`${itemKey}.add`)" class="flex-1">
                <USelectMenu
                    v-model="selectedRouteIds"
                    :items="routeItems"
                    value-key="value"
                    multiple
                    :search-input="{ placeholder: $t('actions.search') }"
                    :placeholder="$t(`${itemKey}.pick`)"
                    :icon="itemIcon"
                    class="w-full"
                    data-testid="competition-route-picker"
                />
            </UFormField>
            <UButton
                v-if="selectedRouteIds.length"
                icon="i-lucide-plus"
                color="primary"
                :loading="pending"
                data-testid="competition-route-add"
                @click="addSelected"
            >
                {{
                    $t('competitions.addCount', { n: selectedRouteIds.length })
                }}
            </UButton>
        </div>

        <LayoutEmptyState
            v-if="!compRoutes?.length"
            :icon="itemIcon"
            :title="$t(`${itemKey}.empty`)"
        />
        <ul v-else class="flex flex-col gap-2">
            <li
                v-for="compRoute in compRoutes"
                :key="compRoute.id"
                class="flex flex-wrap items-end gap-3 rounded-lg bg-default p-3 ring ring-default md:items-center"
                :class="{ 'opacity-60': compRoute.voided }"
                :data-testid="`competition-route-${compRoute.number}`"
            >
                <div
                    class="flex min-w-0 basis-full items-center gap-3 md:flex-1 md:basis-0"
                >
                    <span
                        class="w-8 text-center text-lg font-bold tabular-nums text-highlighted"
                        >{{ compRoute.number }}</span
                    >
                    <RouteSummary :route="routeOf(compRoute)" class="flex-1" />
                </div>
                <UFormField
                    v-if="usesPoints"
                    :label="$t('competitions.points')"
                    size="xs"
                    class="w-28"
                >
                    <UInputNumber
                        :model-value="compRoute.points ?? 0"
                        :min="0"
                        size="sm"
                        :data-testid="`competition-route-points-${compRoute.number}`"
                        @update:model-value="
                            (points) =>
                                patch(compRoute, { points: points ?? 0 })
                        "
                    />
                </UFormField>
                <UFormField
                    v-if="isRope"
                    :label="$t('competitions.holdCount')"
                    size="xs"
                    class="w-28"
                >
                    <UInputNumber
                        :model-value="compRoute.hold_count ?? undefined"
                        :min="1"
                        :max="200"
                        size="sm"
                        :data-testid="`competition-route-holds-${compRoute.number}`"
                        @update:model-value="
                            (holdCount) =>
                                patch(compRoute, { hold_count: holdCount ?? 0 })
                        "
                    />
                </UFormField>
                <USwitch
                    v-else
                    :model-value="compRoute.zone"
                    :label="$t('competitions.zone')"
                    class="h-7 items-center"
                    :data-testid="`competition-route-zone-${compRoute.number}`"
                    @update:model-value="(zone) => patch(compRoute, { zone })"
                />
                <USwitch
                    v-if="competition.status !== 'draft'"
                    :model-value="compRoute.voided"
                    :label="$t('competitions.voided')"
                    class="ms-auto h-7 items-center"
                    color="error"
                    :data-testid="`competition-route-voided-${compRoute.number}`"
                    @update:model-value="
                        (voided) => patch(compRoute, { voided })
                    "
                />
                <UButton
                    v-else
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    class="icon-btn ms-auto"
                    :aria-label="$t('actions.delete')"
                    :data-testid="`competition-route-delete-${compRoute.number}`"
                    @click="remove(compRoute)"
                />
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { nextRouteNumber } from '~/utils/competitions'
import type {
    CompetitionRecord,
    CompetitionRouteRecord,
    RouteRecord,
} from '~/types/models'

const ROUTE_TYPE_BY_DISCIPLINE = { boulder: 'Boulder', rope: 'Route' } as const

const props = defineProps<{ competition: CompetitionRecord }>()

const emit = defineEmits<{ changed: [] }>()

const pb = usePocketbase()
const { t } = useI18n()
const { pending, run } = useAsyncAction()

const selectedRouteIds = ref<string[]>([])

const isRope = computed(() => props.competition.discipline === 'rope')
const itemKey = computed(
    () => `competitions.items.${props.competition.discipline}`,
)
const itemIcon = computed(() =>
    isRope.value ? 'i-lucide-cable' : 'i-lucide-mountain',
)
const usesPoints = computed(() =>
    ['fixed', 'route_points'].includes(props.competition.scoring_format),
)

const { data: compRoutes, refresh } = useAsyncData(
    () => `competition-routes:${props.competition.id}`,
    () =>
        pb
            .collection('competition_routes')
            .getFullList<CompetitionRouteRecord>({
                filter: pb.filter('competition = {:id}', {
                    id: props.competition.id,
                }),
                sort: 'number',
                expand: 'route',
            }),
    { deep: true },
)

const { data: routes } = useAsyncData(
    () =>
        `competition-candidates:${props.competition.location}:${props.competition.discipline}`,
    () =>
        pb.collection('routes').getFullList<RouteRecord>({
            filter: pb.filter(
                'location = {:location} && archived = false && type = {:type}',
                {
                    location: props.competition.location,
                    type: ROUTE_TYPE_BY_DISCIPLINE[
                        props.competition.discipline
                    ],
                },
            ),
            sort: 'grade_index,name',
        }),
    { default: () => [] },
)

const usedRouteIds = computed(
    () => new Set((compRoutes.value ?? []).map((compRoute) => compRoute.route)),
)

const routeItems = computed(() =>
    routes.value
        .filter((route) => !usedRouteIds.value.has(route.id))
        .map((route) => ({
            value: route.id,
            label: `${route.name} · ${route.grade}`,
        })),
)

function routeOf(compRoute: CompetitionRouteRecord) {
    return compRoute.expand?.route as RouteRecord | undefined
}

async function addSelected() {
    const firstNumber = nextRouteNumber(compRoutes.value ?? [])
    await run(
        async () => {
            const collection = pb.collection('competition_routes')
            for (const [offset, route] of selectedRouteIds.value.entries()) {
                await collection.create({
                    competition: props.competition.id,
                    route,
                    number: firstNumber + offset,
                    zone:
                        !isRope.value &&
                        props.competition.scoring_format !== 'fixed',
                })
            }
            selectedRouteIds.value = []
            await refresh()
            emit('changed')
        },
        { success: t(`${itemKey.value}.added`) },
    )
}

async function patch(
    compRoute: CompetitionRouteRecord,
    changes: Partial<CompetitionRouteRecord>,
) {
    Object.assign(compRoute, changes)
    await run(() =>
        pb.collection('competition_routes').update(compRoute.id, changes),
    )
    emit('changed')
}

async function remove(compRoute: CompetitionRouteRecord) {
    await run(async () => {
        await pb.collection('competition_routes').delete(compRoute.id)
        await refresh()
        emit('changed')
    })
}
</script>
