<template>
    <LayoutDialogShell
        v-model="dialog"
        max-width="680"
        closable
        :subtitle="
            $t('notifications.releaseNotes.installedVersion', [
                installedVersion,
            ])
        "
        data-testid="release-notes-dialog"
    >
        <template #activator="activatorScope">
            <slot name="activator" v-bind="activatorScope" />
        </template>

        <template #title>
            <UIcon name="i-lucide-tag" class="size-[20px]" />
            {{ $t('notifications.releaseNotes.title') }}
        </template>

        <div
            v-if="loading"
            class="flex justify-center py-8"
            data-testid="release-notes-loading"
        >
            <UIcon
                name="i-lucide-loader-circle"
                class="size-6 animate-spin text-primary"
            />
        </div>

        <UAlert
            v-else-if="error"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            :description="$t('notifications.releaseNotes.error')"
            data-testid="release-notes-error"
        />

        <UAlert
            v-else-if="!notes && !commits.length"
            color="info"
            variant="soft"
            icon="i-lucide-info"
            :description="$t('notifications.releaseNotes.notFound')"
            data-testid="release-notes-empty"
        />

        <template v-else>
            <section
                v-if="commits.length"
                class="mb-6"
                data-testid="release-notes-commits"
            >
                <div class="flex items-center gap-2 mb-2">
                    <span class="release-version">
                        {{
                            $t('notifications.releaseNotes.sinceRelease', [tag])
                        }}
                    </span>
                    <UBadge size="sm" variant="soft" color="primary">
                        {{ commits.length }}
                    </UBadge>
                </div>
                <div
                    v-for="commit in parsedCommits"
                    :key="commit.sha"
                    class="change-row"
                    data-testid="release-notes-commit"
                >
                    <span
                        :class="[
                            'change-type',
                            `change-type--${commit.category}`,
                        ]"
                    >
                        {{ commit.type ?? '•' }}
                    </span>
                    <div class="change-text">
                        <b v-if="commit.scope">{{ commit.scope }}:</b>
                        {{ commit.subject }}
                        <div class="change-meta">
                            <a
                                v-if="repoUrl"
                                :href="`${repoUrl}/commit/${commit.sha}`"
                                target="_blank"
                                rel="noopener"
                                class="change-link mono"
                                >{{ commit.sha }}</a
                            >
                            <span v-else class="mono">{{ commit.sha }}</span>
                            <span v-if="commit.date">
                                · {{ formatDate(commit.date, { locale }) }}
                            </span>
                            <template v-if="commit.pr">
                                ·
                                <a
                                    v-if="repoUrl"
                                    :href="`${repoUrl}/pull/${commit.pr}`"
                                    target="_blank"
                                    rel="noopener"
                                    class="change-link"
                                    >#{{ commit.pr }}</a
                                >
                                <span v-else>#{{ commit.pr }}</span>
                            </template>
                        </div>
                    </div>
                </div>
            </section>

            <section v-if="notes" data-testid="release-notes-release">
                <div class="flex items-center flex-wrap gap-2 mb-3">
                    <span class="release-version">{{ tag }}</span>
                    <UBadge
                        v-if="installed"
                        size="sm"
                        color="success"
                        variant="soft"
                    >
                        {{ $t('notifications.releaseNotes.installed') }}
                    </UBadge>
                    <span class="release-date">
                        {{ formatDate(publishedAt, { locale }) }}
                    </span>
                    <div class="flex-1" />
                    <UButton
                        v-if="repoUrl && tag"
                        :href="`${repoUrl}/releases/tag/${tag}`"
                        target="_blank"
                        rel="noopener"
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        trailing-icon="i-lucide-external-link"
                    >
                        {{ $t('notifications.releaseNotes.viewOnGithub') }}
                    </UButton>
                </div>

                <template v-if="release.changes.length">
                    <div class="mb-2 flex flex-wrap gap-2">
                        <UButton
                            v-for="filter in filters"
                            :key="filter.value"
                            size="sm"
                            :color="
                                category === filter.value
                                    ? 'primary'
                                    : 'neutral'
                            "
                            :variant="
                                category === filter.value ? 'soft' : 'outline'
                            "
                            :aria-pressed="category === filter.value"
                            :data-testid="`release-notes-filter-${filter.value}`"
                            @click="category = filter.value"
                        >
                            {{
                                $t(
                                    `notifications.releaseNotes.filters.${filter.value}`,
                                )
                            }}
                            <span class="filter-count">{{ filter.count }}</span>
                        </UButton>
                    </div>

                    <div
                        v-for="(change, index) in visibleChanges"
                        :key="index"
                        class="change-row"
                        data-testid="release-notes-change"
                    >
                        <span
                            :class="[
                                'change-type',
                                `change-type--${change.category}`,
                            ]"
                        >
                            {{ change.type ?? '•' }}
                        </span>
                        <div class="change-text">
                            <UBadge
                                v-if="change.breaking"
                                size="sm"
                                color="error"
                                variant="solid"
                                class="me-1"
                            >
                                {{ $t('notifications.releaseNotes.breaking') }}
                            </UBadge>
                            <b v-if="change.scope">{{ change.scope }}:</b>
                            {{ change.subject }}
                            <div class="change-meta">
                                <span v-if="change.author"
                                    >@{{ change.author }}</span
                                >
                                <template v-if="change.pr">
                                    ·
                                    <a
                                        v-if="repoUrl"
                                        :href="`${repoUrl}/pull/${change.pr}`"
                                        target="_blank"
                                        rel="noopener"
                                        class="change-link"
                                        >#{{ change.pr }}</a
                                    >
                                    <span v-else>#{{ change.pr }}</span>
                                </template>
                            </div>
                        </div>
                    </div>

                    <div v-if="release.compare" class="release-footer">
                        {{ $t('notifications.releaseNotes.fullChangelog') }}
                        <a
                            v-if="repoUrl"
                            :href="`${repoUrl}/compare/${release.compare}`"
                            target="_blank"
                            rel="noopener"
                            class="change-link mono"
                            data-testid="release-notes-compare"
                            >{{ release.compare }}</a
                        >
                        <span v-else class="mono">{{ release.compare }}</span>
                    </div>
                </template>

                <div v-else class="release-body">{{ changelog }}</div>
            </section>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import {
    parseChange,
    parseReleaseNotes,
    type ChangeCategory,
} from '#shared/utils/releaseNotes'
import type { VersionCommit } from '~/composables/useVersionCheck'

const props = withDefaults(
    defineProps<{
        tag?: string | null
        notes?: string | null
        publishedAt?: string | null
        installedVersion?: string
        installed?: boolean
        error?: string | null
        loading?: boolean
        commits?: VersionCommit[]
        repoUrl?: string | null
    }>(),
    { commits: () => [], repoUrl: null },
)

const { locale } = useI18n()
const dialog = defineModel<boolean>('open', { default: false })
const category = ref<'all' | ChangeCategory>('all')

const release = computed(() => parseReleaseNotes(props.notes))

const parsedCommits = computed(() =>
    props.commits.map((commit) => ({
        ...commit,
        ...parseChange(commit.message),
    })),
)

const filters = computed(() => {
    const count = (value: ChangeCategory) =>
        release.value.changes.filter((change) => change.category === value)
            .length
    return [
        { value: 'all' as const, count: release.value.changes.length },
        ...(['feat', 'fix', 'deps', 'other'] as const).map((value) => ({
            value,
            count: count(value),
        })),
    ].filter((filter) => filter.count > 0)
})

const visibleChanges = computed(() =>
    category.value === 'all'
        ? release.value.changes
        : release.value.changes.filter(
              (change) => change.category === category.value,
          ),
)

const changelog = computed(() =>
    (props.notes ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/^\s*[-*]\s+/gm, '• ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim(),
)
</script>

<style scoped>
.release-version {
    font-weight: 600;
    font-size: 15px;
}

.release-date {
    font-size: 12px;
    color: color-mix(in oklab, var(--ui-text-highlighted) 55%, transparent);
}

.release-body {
    white-space: pre-wrap;
    font-size: 13px;
    color: color-mix(in oklab, var(--ui-text-highlighted) 75%, transparent);
    word-break: break-word;
}

.filter-count {
    margin-left: 6px;
    opacity: 0.6;
    font-size: 0.75em;
}

.change-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid
        color-mix(in oklab, var(--ui-text-highlighted) 6%, transparent);
    font-size: 13px;
}

.change-row:last-of-type {
    border-bottom: none;
}

.change-type {
    flex: 0 0 64px;
    padding: 1px 0;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    text-transform: lowercase;
    background: color-mix(in oklab, var(--ui-text-highlighted) 7%, transparent);
    color: color-mix(in oklab, var(--ui-text-highlighted) 70%, transparent);
}

.change-type--feat {
    background: color-mix(in oklab, var(--ui-primary) 14%, transparent);
    color: var(--ui-primary);
}

.change-type--fix {
    background: color-mix(in oklab, var(--ui-error) 12%, transparent);
    color: var(--ui-error);
}

.change-type--deps {
    background: color-mix(in oklab, var(--ui-text-highlighted) 5%, transparent);
    color: color-mix(in oklab, var(--ui-text-highlighted) 50%, transparent);
}

.change-text {
    flex: 1;
    min-width: 0;
    word-break: break-word;
    color: color-mix(in oklab, var(--ui-text-highlighted) 87%, transparent);
}

.change-meta {
    font-size: 12px;
    color: color-mix(in oklab, var(--ui-text-highlighted) 55%, transparent);
}

.change-link {
    color: var(--ui-primary);
    text-decoration: none;
}

.change-link:hover {
    text-decoration: underline;
}

.release-footer {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid
        color-mix(in oklab, var(--ui-text-highlighted) 6%, transparent);
    font-size: 12px;
    color: color-mix(in oklab, var(--ui-text-highlighted) 55%, transparent);
}

.mono {
    font-family: monospace;
}
</style>
