<template>
    <LayoutPanel
        :title="t('platform.retiredSlugs.title')"
        data-testid="platform-retired-slugs"
    >
        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        />
        <LayoutEmptyState
            v-else-if="!slugs?.length"
            icon="i-lucide-link-2-off"
            :title="t('platform.retiredSlugs.empty')"
        />
        <LayoutListGroup v-else>
            <LayoutListRow
                v-for="slug in slugs"
                :key="slug.id"
                :data-testid="`platform-retired-slug-${slug.slug}`"
            >
                <div class="min-w-0 flex-1">
                    <div class="truncate font-medium">/{{ slug.slug }}</div>
                    <div class="truncate text-sm text-muted">
                        {{ slug.gym_name }} ·
                        {{
                            formatDate(slug.retired_at, {
                                locale,
                                timeZone: 'UTC',
                            })
                        }}
                    </div>
                </div>
                <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-unlink"
                    class="icon-btn"
                    :aria-label="t('platform.retiredSlugs.free')"
                    :data-testid="`platform-retired-slug-free-${slug.slug}`"
                    @click="pending = slug"
                />
            </LayoutListRow>
        </LayoutListGroup>

        <ConfirmDialog
            :model-value="!!pending"
            :title="t('platform.retiredSlugs.free')"
            :message="
                t('platform.retiredSlugs.freeConfirm', {
                    slug: pending?.slug ?? '',
                })
            "
            :confirm-text="t('platform.retiredSlugs.free')"
            :loading="freeing"
            @update:model-value="(open: boolean) => !open && (pending = null)"
            @confirm="free"
        />
    </LayoutPanel>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import { freeRetiredSlug, listRetiredSlugs, type RetiredSlug } from '~/api/gyms'

const { t, locale } = useI18n()

const {
    data: slugs,
    error,
    refresh,
} = useAsyncData('platform-retired-slugs', listRetiredSlugs)

const pending = ref<RetiredSlug | null>(null)
const { pending: freeing, run } = useAsyncAction()

async function free() {
    const slug = pending.value
    if (!slug) return
    await run(
        async () => {
            await freeRetiredSlug(slug.id)
            pending.value = null
            await refresh()
        },
        { success: t('platform.retiredSlugs.freed', { slug: slug.slug }) },
    )
}
</script>
