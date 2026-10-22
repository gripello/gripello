<template>
    <div :class="{ 'max-lg:pb-24': hasChanges }">
        <template v-if="drillDown">
            <template v-if="!sectionChosen">
                <LayoutListGroup
                    v-for="group in drillGroups"
                    :key="group.danger ? 'danger' : 'sections'"
                    class="mb-4 lg:hidden"
                    :class="{ 'mt-8': group.danger }"
                    :aria-label="$t('settings.sections')"
                >
                    <LayoutListRow
                        v-for="section in group.sections"
                        :key="section.id"
                        :to="{ query: { [queryKey]: section.id } }"
                        :data-testid="`${testIdPrefix}-drill-${section.id}`"
                    >
                        <UIcon
                            :name="section.icon"
                            class="size-5"
                            :class="group.danger ? 'text-error' : 'text-muted'"
                        />
                        <span
                            class="flex-1"
                            :class="
                                group.danger ? 'text-error' : 'text-highlighted'
                            "
                        >
                            {{ section.label }}
                        </span>
                        <UChip
                            v-if="section.badge"
                            color="warning"
                            size="sm"
                            standalone
                            inset
                        />
                        <UIcon
                            name="i-lucide-chevron-right"
                            class="size-5 text-dimmed"
                        />
                    </LayoutListRow>
                </LayoutListGroup>
            </template>
        </template>
        <LayoutTabs
            v-else
            v-model="selectedSection"
            :items="sectionTabItems"
            :content="false"
            class="mb-4 lg:hidden"
            :aria-label="$t('settings.sections')"
        >
            <template #default="{ item }">
                <UChip :show="!!item.warning" color="warning" size="sm">
                    <span
                        :data-testid="`${testIdPrefix}-section-${item.value}`"
                    >
                        {{ item.label }}
                    </span>
                </UChip>
            </template>
        </LayoutTabs>
        <LayoutTabs
            v-if="desktopTabs"
            v-model="selectedSection"
            :items="sectionTabItems"
            :content="false"
            class="mb-4 max-lg:hidden"
            :aria-label="$t('settings.sections')"
        >
            <template #default="{ item }">
                <UChip :show="!!item.warning" color="warning" size="sm">
                    <span :data-testid="`${testIdPrefix}-tab-${item.value}`">
                        {{ item.label }}
                    </span>
                </UChip>
            </template>
        </LayoutTabs>

        <div class="flex gap-8">
            <aside v-if="!desktopTabs" class="hidden w-52 shrink-0 lg:block">
                <nav
                    class="settings-nav-desktop"
                    :aria-label="$t('settings.sections')"
                >
                    <UNavigationMenu
                        :items="sectionNavItems"
                        orientation="vertical"
                        highlight
                    />
                </nav>
            </aside>

            <div class="flex min-w-0 flex-1 flex-col gap-6">
                <LayoutSaveBar
                    class="lg:-mb-6"
                    :show="hasChanges"
                    :loading="saving"
                    :disabled="saveDisabled"
                    :test-id-prefix="testIdPrefix"
                    cancelable
                    @save="emit('save')"
                    @cancel="emit('cancel')"
                />
                <div
                    class="contents"
                    :class="{ 'max-lg:hidden': drillDown && !sectionChosen }"
                >
                    <slot :active-section="activeSection" />
                </div>
            </div>
        </div>

        <ConfirmDialog
            v-model="discardDialogOpen"
            :title="$t('account.unsavedChanges')"
            :message="$t('mapEditor.discard')"
            :confirm-text="$t('mapPlacement.discard')"
            @confirm="settleDiscard(true)"
        />
    </div>
</template>

<script setup lang="ts">
import { requestedSection } from '~/utils/navigation'

const props = withDefaults(
    defineProps<{
        sections: {
            id: string
            label: string
            icon: string
            danger?: boolean
            badge?: boolean
        }[]
        hasChanges: boolean
        testIdPrefix: string
        saving?: boolean
        saveDisabled?: boolean
        unsavedChanges?: boolean
        drillDown?: boolean
        desktopTabs?: boolean
        queryKey?: string
    }>(),
    { queryKey: 'section', unsavedChanges: undefined },
)
const emit = defineEmits<{ save: []; cancel: [] }>()

const route = useRoute()
const activeSection = computed(() =>
    requestedSection(
        route.query[props.queryKey],
        props.sections.map((section) => section.id),
    ),
)

const sectionChosen = computed(() => !!route.query[props.queryKey])
const { select } = useSectionQuery(props.queryKey)

const pageBackTo = usePageBackTo()
const sectionBackOwner = -1
let headerBackTo: typeof pageBackTo.value = null
function releasePageBack() {
    if (pageBackTo.value?.owner === sectionBackOwner)
        pageBackTo.value = headerBackTo
}
watch(
    () => props.drillDown && sectionChosen.value,
    (inSection) => {
        if (!inSection) return releasePageBack()
        if (pageBackTo.value?.owner !== sectionBackOwner)
            headerBackTo = pageBackTo.value
        pageBackTo.value = { owner: sectionBackOwner, to: route.path }
    },
    { immediate: true },
)
onUnmounted(releasePageBack)

const selectedSection = computed({
    get: () => activeSection.value,
    set: select,
})

const sectionTabItems = computed(() =>
    props.sections.map((section) => ({
        label: section.label,
        icon: section.icon,
        value: section.id,
        warning: section.badge,
    })),
)

const drillGroups = computed(() =>
    [false, true]
        .map((danger) => ({
            danger,
            sections: props.sections.filter(
                (section) => !!section.danger === danger,
            ),
        }))
        .filter((group) => group.sections.length),
)

const sectionNavItems = computed(() =>
    props.sections.map((section) => ({
        label: section.label,
        icon: section.icon,
        class: section.danger ? 'mt-6 text-error' : undefined,
        to: { query: { [props.queryKey]: section.id } },
        replace: true,
        active: activeSection.value === section.id,
        'data-testid': `${props.testIdPrefix}-section-${section.id}`,
    })),
)

const { discardDialogOpen, settleDiscard, leaveGuard } = useDiscardConfirm(
    () => props.unsavedChanges ?? props.hasChanges,
)
onBeforeRouteLeave(leaveGuard)
</script>

<style scoped>
.settings-nav-desktop {
    position: sticky;
    top: calc(var(--app-top) + var(--app-top-inset, 0px) + 16px);
}
</style>
