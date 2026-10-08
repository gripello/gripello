<template>
    <LayoutDialogShell
        v-model="dialog"
        max-width="640"
        closable
        sheet-on-mobile
        :subtitle="
            $t('notifications.commitList.installedCommit', [props.installedSha])
        "
        data-testid="commit-list-dialog"
    >
        <template #activator="activatorScope">
            <slot name="activator" v-bind="activatorScope" />
        </template>

        <template #title>
            <UIcon name="i-lucide-git-commit-horizontal" class="size-[20px]" />
            {{ $t('notifications.commitList.title') }}
        </template>

        <LayoutEmptyState
            v-if="!props.commits.length"
            icon="i-lucide-git-commit-horizontal"
            :card="false"
            :title="$t('notifications.commitList.empty')"
            data-testid="commit-list-empty"
        />

        <div
            v-for="commit in parsedCommits"
            v-else
            :key="commit.sha"
            class="commit-entry"
        >
            <div class="flex items-center flex-wrap gap-2 mb-1">
                <a
                    v-if="repoUrl"
                    :href="`${repoUrl}/commit/${commit.sha}`"
                    target="_blank"
                    rel="noopener"
                    class="commit-sha commit-link"
                    >{{ commit.sha }}</a
                >
                <span v-else class="commit-sha">{{ commit.sha }}</span>
                <span class="commit-date">
                    {{ formatDate(commit.date, { locale }) }}
                </span>
            </div>
            <div class="commit-message">
                {{ commit.text }}
                <template v-if="commit.pr">
                    <a
                        v-if="repoUrl"
                        :href="`${repoUrl}/pull/${commit.pr}`"
                        target="_blank"
                        rel="noopener"
                        class="commit-link"
                        data-testid="commit-pr-link"
                        >#{{ commit.pr }}</a
                    >
                    <span v-else>#{{ commit.pr }}</span>
                </template>
            </div>
        </div>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import { parseChange } from '#shared/utils/releaseNotes'
import type { VersionCommit } from '~/composables/useVersionCheck'

const props = withDefaults(
    defineProps<{
        commits?: VersionCommit[]
        installedSha?: string
        repoUrl?: string | null
    }>(),
    { commits: () => [], installedSha: '', repoUrl: null },
)

const { locale } = useI18n()
const dialog = ref(false)

const parsedCommits = computed(() =>
    props.commits.map((commit) => {
        const change = parseChange(commit.message)
        const prefix = change.type
            ? `${change.type}${change.scope ? `(${change.scope})` : ''}: `
            : ''
        return { ...commit, text: `${prefix}${change.subject}`, pr: change.pr }
    }),
)
</script>

<style scoped>
.commit-entry {
    padding: 8px 0;
    border-bottom: 1px solid
        color-mix(in oklab, var(--ui-text-highlighted) 8%, transparent);
}

.commit-entry:last-child {
    border-bottom: none;
}

.commit-sha {
    font-family: monospace;
    font-weight: 600;
    font-size: 13px;
}

.commit-link {
    color: var(--ui-primary);
    text-decoration: none;
}

.commit-link:hover {
    text-decoration: underline;
}

.commit-date {
    font-size: 12px;
    color: color-mix(in oklab, var(--ui-text-highlighted) 55%, transparent);
}

.commit-message {
    font-size: 13px;
    color: color-mix(in oklab, var(--ui-text-highlighted) 85%, transparent);
    word-break: break-word;
}
</style>
