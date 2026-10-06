<template>
    <div class="mx-auto w-full p-4" data-testid="staff-hub">
        <LayoutPageHeader :title="t('nav.staffTools')" />
        <LayoutEmptyState
            v-if="!sections.length"
            icon="i-lucide-wrench"
            :title="t('nav.noStaffTools')"
            data-testid="staff-hub-empty"
        />
        <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <section
                v-for="section in sections"
                :key="section.key"
                :data-testid="`staff-hub-${section.key}`"
            >
                <p class="native-heading">{{ t(section.label) }}</p>
                <div class="native-group">
                    <NuxtLink
                        v-for="link in section.links"
                        :key="link.to"
                        :to="link.to"
                        class="native-row"
                        :style="{ '--native-tint': SECTION_TINTS[section.key] }"
                        :data-testid="`staff-hub-link-${navTestId(link.path ?? link.to)}`"
                    >
                        <span class="native-row__icon">
                            <UIcon :name="link.icon" />
                        </span>
                        <span class="native-row__text">{{
                            t(link.label)
                        }}</span>
                        <UIcon
                            name="i-lucide-chevron-right"
                            class="native-row__chevron"
                        />
                    </NuxtLink>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
import { staffSections } from '~/utils/navigation'

definePageMeta({ middleware: ['auth'] })

const { t } = useI18n()
const { can } = usePermissions()
const { slug } = useGym()

useSeoMeta({ title: () => t('nav.staffTools') })

const sections = computed(() => staffSections(can, slug.value))

const SECTION_TINTS: Record<string, string> = {
    manage: 'var(--ui-info)',
    moderation: 'var(--ui-warning)',
    admin: 'var(--ui-text-muted)',
}
</script>
