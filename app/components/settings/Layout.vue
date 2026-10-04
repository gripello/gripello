<template>
    <div :class="{ 'max-lg:pb-24': hasChanges }">
        <nav
            class="settings-nav-mobile lg:hidden"
            :aria-label="$t('settings.sections')"
        >
            <UNavigationMenu
                :items="sectionNavItems"
                highlight
                class="w-max min-w-full"
            />
        </nav>

        <div class="flex gap-8">
            <aside class="hidden w-52 shrink-0 lg:block">
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
                    :show="hasChanges"
                    :loading="saving"
                    :test-id-prefix="testIdPrefix"
                    cancelable
                    @save="emit('save')"
                    @cancel="emit('cancel')"
                />
                <slot :active-section="activeSection" />
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

const props = defineProps<{
    sections: { id: string; label: string; icon: string }[]
    hasChanges: boolean
    testIdPrefix: string
    saving?: boolean
}>()
const emit = defineEmits<{ save: []; cancel: [] }>()

const route = useRoute()
const activeSection = computed(() =>
    requestedSection(
        route.query.section,
        props.sections.map((section) => section.id),
    ),
)

const sectionNavItems = computed(() =>
    props.sections.map((section) => ({
        label: section.label,
        icon: section.icon,
        to: { query: { section: section.id } },
        active: activeSection.value === section.id,
        'data-testid': `${props.testIdPrefix}-section-${section.id}`,
    })),
)

const { discardDialogOpen, confirmDiscard, settleDiscard } = useDiscardConfirm(
    () => props.hasChanges,
)
onBeforeRouteLeave(() => confirmDiscard())
</script>

<style scoped>
.settings-nav-mobile {
    position: sticky;
    top: calc(var(--app-top) + var(--app-top-inset, 0px));
    z-index: 10;
    margin: 0 -16px 16px;
    padding: 0 16px;
    overflow-x: auto;
    background: var(--app-bg);
    scrollbar-width: none;
}

.settings-nav-desktop {
    position: sticky;
    top: calc(var(--app-top) + var(--app-top-inset, 0px) + 16px);
}
</style>
