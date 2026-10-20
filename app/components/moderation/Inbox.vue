<template>
    <div class="flex flex-col gap-4">
        <FilterBar
            v-model="search"
            :search-label="t('actions.search')"
            :active-filter-count="activeFilterCount"
            @clear="clearFilters"
        >
            <template #search>
                <SegmentedControl
                    v-model="view"
                    :items="viewItems"
                    test-id="moderation-view"
                    data-testid="moderation-views"
                />
                <UInput
                    v-model="search"
                    icon="i-lucide-search"
                    :placeholder="t('actions.search')"
                    :aria-label="t('actions.search')"
                    class="min-w-48 flex-1"
                    data-testid="moderation-search"
                />
            </template>
            <template #filters>
                <FilterSelect
                    v-model="contentType"
                    :label="t('moderation.filterType')"
                    :items="typeItems"
                    value-key="value"
                    :placeholder="t('filter.all')"
                    clear
                    data-testid="moderation-filter-type"
                    @clear="contentType = undefined"
                />
                <FilterSelect
                    v-if="platform"
                    v-model="gymFilter"
                    :label="t('moderation.filterGym')"
                    :items="gymItems"
                    value-key="value"
                    :placeholder="t('filter.all')"
                    clear
                    data-testid="moderation-filter-gym"
                    @clear="gymFilter = undefined"
                />
            </template>
            <template v-if="authorFilter" #below>
                <div class="px-3 pb-3">
                    <UBadge
                        color="neutral"
                        variant="outline"
                        size="lg"
                        class="gap-1"
                    >
                        {{ authorFilter.name }}
                        <UButton
                            icon="i-lucide-x"
                            color="neutral"
                            variant="link"
                            size="xs"
                            :aria-label="t('filter.clear')"
                            data-testid="moderation-author-clear"
                            @click="authorFilter = null"
                        />
                    </UBadge>
                </div>
            </template>
        </FilterBar>

        <p
            v-if="newCount"
            class="text-sm text-muted"
            data-testid="moderation-new"
        >
            {{ t('moderation.newSinceVisit', newCount) }}
        </p>

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
            data-testid="moderation-error"
        />
        <LayoutLoadingState
            v-else-if="!loaded || (loading && !items.length)"
            type="list-item-avatar-three-line, actions"
        />
        <LayoutEmptyState
            v-else-if="!items.length"
            icon="i-lucide-shield-check"
            :title="t(`moderation.empty.${view}`)"
            data-testid="moderation-empty"
        />
        <div v-else class="flex flex-wrap items-start gap-4">
            <div
                class="flex w-full flex-col gap-2.5 lg:w-[26rem] lg:shrink-0"
                data-testid="moderation-list"
            >
                <LayoutListGroup>
                    <ModerationCaseCard
                        v-for="item in items"
                        :key="item.id"
                        :item="item"
                        :selected="lgAndUp && item.id === selected?.id"
                        :is-new="isNewSince(item.created, seenBefore)"
                        :platform="platform"
                        @select="select(item)"
                    />
                </LayoutListGroup>
                <UButton
                    v-if="hasMore"
                    color="neutral"
                    variant="soft"
                    block
                    :loading="loadingMore"
                    data-testid="moderation-load-more"
                    @click="loadMore"
                >
                    {{ t('actions.load_more') }}
                </UButton>
            </div>
            <ModerationCaseDetail
                v-if="lgAndUp && selected"
                :item="selected"
                :actions="selected.actions ?? []"
                :platform="platform"
                :busy="busy"
                class="min-w-0 flex-1 lg:sticky lg:top-20"
                @act="(action) => start(selected!, action)"
                @show-author="filterByAuthor(selected!)"
                @hide-author="authorTarget = selected"
                @suspend-author="openSuspend(selected!)"
            />
            <LayoutEmptyState
                v-else-if="lgAndUp"
                icon="i-lucide-circle-check"
                :title="t('moderation.decidedElsewhere')"
                class="min-w-0 flex-1"
                data-testid="moderation-decided-elsewhere"
            />
        </div>

        <LayoutDialogShell
            v-if="!lgAndUp"
            v-model="sheetOpen"
            sheet-on-mobile
            flush
            closable
            :title="
                selected ? t(`moderation.types.${selected.content_type}`) : ''
            "
        >
            <ModerationCaseDetail
                v-if="selected"
                :item="selected"
                :actions="selected.actions ?? []"
                :platform="platform"
                :busy="busy"
                class="border-0"
                @act="(action) => start(selected!, action)"
                @show-author="filterByAuthor(selected!)"
                @hide-author="authorTarget = selected"
                @suspend-author="openSuspend(selected!)"
            />
        </LayoutDialogShell>

        <ModerationDecisionDialog
            v-model="decisionOpen"
            :title="
                pending ? t(`moderation.confirmTitle.${pending.action}`) : ''
            "
            :subject="pending ? subjectOf(pending.item) : ''"
            :confirm-label="
                pending ? t(`moderation.confirm.${pending.action}`) : ''
            "
            :consequences="
                pending ? consequencesOf(pending.item, pending.action) : []
            "
            :loading="busy"
            @confirm="
                (reason) => pending && act(pending.item, pending.action, reason)
            "
        />

        <ModerationDecisionDialog
            :model-value="!!authorTarget"
            :title="t('moderation.author.hideAll')"
            :subject="authorTarget?.context?.author?.name"
            :confirm-label="t('moderation.author.hideAllConfirm')"
            :consequences="[
                t('moderation.decision.authorAll'),
                t('moderation.decision.authorInformed'),
                t('moderation.decision.restorable'),
            ]"
            :loading="busy"
            @update:model-value="authorTarget = null"
            @confirm="hideAuthor"
        />

        <PlatformSuspendDialog
            v-if="platform"
            :model-value="!!suspendUser"
            :user="suspendUser"
            @update:model-value="suspendUser = null"
            @changed="reloadAll"
        />
    </div>
</template>

<script setup lang="ts">
import { isNewSince } from '~/utils/moderation'

const props = defineProps<{ gymId?: string; platform?: boolean }>()

const { t } = useI18n()
const {
    view,
    search,
    contentType,
    gymFilter,
    authorFilter,
    activeFilterCount,
    clearFilters,
    viewItems,
    typeItems,
    gymItems,
    items,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore,
    loaded,
    selected,
    sheetOpen,
    select,
    newCount,
    seenBefore,
    subjectOf,
    consequencesOf,
    busy,
    decisionOpen,
    pending,
    authorTarget,
    suspendUser,
    openSuspend,
    start,
    act,
    hideAuthor,
    filterByAuthor,
    reloadAll,
    lgAndUp,
} = useModerationInbox({
    gymId: () => props.gymId,
    platform: () => !!props.platform,
})
</script>
