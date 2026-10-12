<template>
    <div class="flex flex-col gap-3" data-testid="wall-reset">
        <div class="flex flex-wrap items-center gap-2">
            <span
                class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring ring-default"
                data-testid="reset-urgency"
            >
                <span
                    class="size-2.5 rounded-full"
                    :style="{ background: heatColor(row.heat) }"
                />
                {{ t(`resets.urgency.${heatLevel(row.heat)}`) }}
            </span>
            <span class="text-xs text-muted tabular-nums">{{
                t('resets.flaggedOf', {
                    flagged: row.flagged.length,
                    total: row.routes.length,
                })
            }}</span>
            <UBadge
                v-if="row.plannedFor"
                color="warning"
                variant="soft"
                size="sm"
                icon="i-lucide-calendar-clock"
                class="tabular-nums"
                data-testid="reset-planned"
            >
                {{ formatDay(row.plannedFor) }} · {{ row.planned.length }}
            </UBadge>
        </div>

        <div class="flex flex-col gap-2">
            <LayoutEyebrow>{{ t('resets.date') }}</LayoutEyebrow>
            <div class="flex flex-wrap gap-2">
                <UButton
                    v-for="weeks in [1, 2, 4]"
                    :key="weeks"
                    size="sm"
                    class="rounded-full"
                    :color="
                        plannedFor === inWeeks(weeks) ? 'primary' : 'neutral'
                    "
                    :variant="
                        plannedFor === inWeeks(weeks) ? 'soft' : 'outline'
                    "
                    :aria-pressed="plannedFor === inWeeks(weeks)"
                    :data-testid="`reset-in-${weeks}w`"
                    @click="plannedFor = inWeeks(weeks)"
                >
                    {{ t('resets.inWeeks', weeks) }}
                </UButton>
                <UInput
                    v-model="plannedFor"
                    type="date"
                    size="sm"
                    class="w-40"
                    :aria-label="t('resets.date')"
                    data-testid="reset-date"
                />
            </div>
        </div>

        <div class="flex flex-col gap-2">
            <LayoutEyebrow data-testid="reset-selected-count">
                {{
                    t('resets.selectedOf', {
                        selected: selected.size,
                        total: plannable.length,
                    })
                }}
            </LayoutEyebrow>
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-muted">{{
                    t('resets.selectLabel')
                }}</span>
                <UButton
                    v-for="preset in presets"
                    :key="preset.key"
                    size="xs"
                    class="rounded-full"
                    :color="preset.active ? 'primary' : 'neutral'"
                    :variant="preset.active ? 'soft' : 'outline'"
                    :aria-pressed="preset.active"
                    :data-testid="`reset-select-${preset.key}`"
                    @click="selected = preset.ids"
                >
                    {{ t(`resets.select.${preset.key}`) }}
                    <span
                        v-if="preset.key !== 'none'"
                        class="tabular-nums text-muted"
                        >{{ preset.ids.size }}</span
                    >
                </UButton>
            </div>
            <ul class="-mx-1 flex flex-col">
                <li v-for="route in row.routes" :key="route.id">
                    <label
                        class="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-elevated/60"
                        :class="{
                            'cursor-not-allowed opacity-60': route.permanent,
                        }"
                        :data-testid="`reset-route-${route.id}`"
                    >
                        <UCheckbox
                            :model-value="selected.has(route.id)"
                            :disabled="route.permanent"
                            @update:model-value="toggle(route.id, !!$event)"
                        />
                        <span
                            class="h-8 w-1 shrink-0 rounded-full"
                            :style="{
                                background: route.permanent
                                    ? 'var(--ui-border)'
                                    : heatColor(urgency.get(route.id) ?? 0),
                            }"
                        />
                        <RouteColorDot :color="route.color" :size="22" />
                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-medium">{{
                                route.name
                            }}</span>
                            <ManageRouteFlags
                                :route="route"
                                :flags="row.flags.get(route.id) ?? []"
                                :stat="stats.get(route.id)"
                                :now="now"
                            />
                        </span>
                        <GradeLabel
                            :source="route"
                            class="w-10 text-right text-sm font-semibold"
                        />
                    </label>
                </li>
            </ul>
        </div>

        <div
            class="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-default bg-default py-2"
        >
            <UButton
                v-if="row.planned.length"
                color="error"
                variant="ghost"
                :loading="pending"
                data-testid="reset-clear"
                @click="clearPlan"
            >
                {{ t('resets.clear') }}
            </UButton>
            <UButton
                v-if="row.planned.length"
                color="neutral"
                variant="soft"
                icon="i-lucide-check-check"
                :loading="pending"
                data-testid="reset-done"
                @click="doneOpen = true"
            >
                {{ t('resets.doneAction') }}
            </UButton>
            <slot name="actions" />
            <div class="flex-1" />
            <UButton
                color="primary"
                icon="i-lucide-calendar-check"
                :disabled="!selected.size || !plannedFor"
                :loading="pending"
                data-testid="reset-save"
                @click="savePlan"
            >
                {{ t('resets.planAction', selected.size) }}
            </UButton>
        </div>

        <ConfirmDialog
            v-model="doneOpen"
            :title="t('resets.done', { wall: row.wall.name })"
            :message="t('resets.doneConfirm', row.planned.length)"
            :confirm-text="t('resets.doneAction')"
            :loading="pending"
            @confirm="finish"
        />
    </div>
</template>

<script setup lang="ts">
import { archiveRoutes, planRouteRemoval, type ResetStat } from '~/api/routes'
import { formatDate } from '#shared/utils/formatting'
import type { RouteRecord, WallRecord } from '~/types/models'
import {
    defaultRemovalSelection,
    heatColor,
    heatLevel,
    oldestHalf,
    plannableRoutes,
    weeksFromToday as inWeeks,
    type WallResetRow,
} from '~/utils/wallResets'

const props = defineProps<{
    row: WallResetRow<WallRecord, RouteRecord>
    stats: ReadonlyMap<string, ResetStat>
    urgency: ReadonlyMap<string, number>
    now: Date
}>()
const emit = defineEmits<{ changed: [] }>()

const { t, locale } = useI18n()
const gymId = useCurrentGymId()
const { pending, run } = useAsyncAction()

const selected = ref(new Set<string>())
const plannedFor = ref('')
const doneOpen = ref(false)

watch(
    () => props.row.wall.id,
    () => {
        selected.value = defaultRemovalSelection(props.row)
        plannedFor.value = props.row.plannedFor ?? inWeeks(1)
    },
    { immediate: true },
)

const plannable = computed(() => plannableRoutes(props.row))

watch(plannable, (routes) => {
    const live = new Set(routes.map((route) => route.id))
    const kept = [...selected.value].filter((id) => live.has(id))
    if (kept.length !== selected.value.size) selected.value = new Set(kept)
})

const presets = computed(() => {
    const ids = (list: RouteRecord[]) => new Set(list.map((route) => route.id))
    const sameAs = (picked: Set<string>) =>
        picked.size === selected.value.size &&
        [...picked].every((id) => selected.value.has(id))
    return [
        {
            key: 'flagged',
            ids: ids(props.row.flagged.filter((route) => !route.permanent)),
        },
        { key: 'oldest', ids: oldestHalf(props.row, props.now) },
        { key: 'all', ids: ids(plannable.value) },
        { key: 'none', ids: new Set<string>() },
    ].map((preset) => ({ ...preset, active: sameAs(preset.ids) }))
})

const formatDay = (value: string) =>
    formatDate(value, { locale: locale.value, dateStyle: 'medium' })

function toggle(id: string, on: boolean) {
    const next = new Set(selected.value)
    if (on) next.add(id)
    else next.delete(id)
    selected.value = next
}

async function savePlan() {
    const dropped = props.row.planned
        .filter((route) => !selected.value.has(route.id))
        .map((route) => route.id)
    const saved = await run(
        async () => {
            await planRouteRemoval(
                gymId.value,
                [...selected.value],
                plannedFor.value,
            )
            await planRouteRemoval(gymId.value, dropped, null)
            return true
        },
        { success: t('notifications.success.edit') },
    )
    if (saved) emit('changed')
}

async function clearPlan() {
    const cleared = await run(
        async () => {
            await planRouteRemoval(
                gymId.value,
                props.row.planned.map((route) => route.id),
                null,
            )
            return true
        },
        { success: t('notifications.success.edit') },
    )
    if (cleared) emit('changed')
}

async function finish() {
    const done = await run(
        async () => {
            await archiveRoutes(
                gymId.value,
                props.row.planned.map((route) => route.id),
            )
            return true
        },
        { success: t('resets.doneSuccess', { wall: props.row.wall.name }) },
    )
    doneOpen.value = false
    if (done) emit('changed')
}
</script>
