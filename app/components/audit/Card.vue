<template>
    <li
        class="flex items-start gap-3 px-4 py-3"
        :data-testid="`audit-card-${entry.id}`"
    >
        <UIcon
            :name="actionIcon(entry.action)"
            class="audit-card__icon size-[20px]"
            :class="actionTextClass"
        />

        <div class="audit-card__text">
            <div class="audit-card__summary">
                <span
                    class="font-medium"
                    :class="actionTextClass"
                    data-testid="audit-card-action"
                >
                    {{ t(`audit.action.${entry.action}`) }}
                </span>
                <template v-if="targetLabel">
                    <span class="audit-card__dot">·</span>
                    <span class="font-medium" data-testid="audit-card-target">{{
                        targetLabel
                    }}</span>
                </template>
            </div>

            <div class="audit-card__meta text-xs">
                <span data-testid="audit-card-actor">{{ actorName }}</span>
                <template v-if="entry.record_id">
                    <NuxtLink
                        v-if="targetUrl"
                        :to="targetUrl"
                        class="audit-card__link"
                        data-testid="audit-card-record"
                        >{{ entry.record_id }}</NuxtLink
                    >
                    <span v-else>{{ entry.record_id }}</span>
                </template>
                <span v-if="ip">{{ ip }}</span>
            </div>

            <div v-if="changedFields.length" class="audit-card__meta text-xs">
                <span
                    >{{ t('audit.changedLabel') }}:
                    <span data-testid="audit-card-fields">{{
                        changedFields.join(', ')
                    }}</span></span
                >
            </div>
        </div>

        <time
            class="audit-card__time text-xs"
            :datetime="entry.created ?? undefined"
            :title="absoluteTime"
            data-testid="audit-card-time"
            >{{ relativeTime }}</time
        >
    </li>
</template>

<script setup lang="ts">
import {
    actionColor,
    actionIcon,
    auditTargetUrl,
    compressIp,
    isRecordAction,
    isSuperuserEntry,
} from '~/utils/audit'
import { formatDate, timeAgo } from '#shared/utils/formatting'
import type { AuditLogRecord } from '~/types/models'

const props = defineProps<{ entry: AuditLogRecord }>()

const { t, te, locale } = useI18n()

const actorName = computed(() => {
    if (isSuperuserEntry(props.entry)) return t('audit.superuser')
    return props.entry.actor_label || t('audit.anonymous')
})

const targetLabel = computed(() => {
    const name = props.entry.collection_name
    if (!name || !isRecordAction(props.entry.action)) return ''
    return te(`audit.target.${name}`) ? t(`audit.target.${name}`) : name
})

const targetUrl = computed(() =>
    auditTargetUrl(
        props.entry.collection_name,
        props.entry.record_id,
        props.entry.expand?.gym?.slug,
    ),
)

const actionTextClass = computed(
    () =>
        ({
            success: 'text-success',
            info: 'text-info',
            error: 'text-error',
            primary: 'text-primary',
            warning: 'text-warning',
        })[actionColor(props.entry.action)] ?? 'text-muted',
)

const changedFields = computed(() => props.entry.changed_fields ?? [])
const ip = computed(() => compressIp(props.entry.ip))

const relativeTime = computed(() =>
    timeAgo(props.entry.created, t, locale.value),
)

const absoluteTime = computed(() =>
    formatDate(props.entry.created, { locale: locale.value, withTime: true }),
)
</script>

<style scoped>
.audit-card__icon {
    flex-shrink: 0;
    margin-top: 2px;
}

.audit-card__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.audit-card__summary {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}

.audit-card__meta {
    display: flex;
    align-items: center;
    gap: 2px 12px;
    flex-wrap: wrap;
    color: color-mix(in oklab, var(--ui-text-highlighted) 70%, transparent);
}

.audit-card__dot {
    opacity: 0.45;
}

.audit-card__link {
    color: inherit;
}

.audit-card__time {
    flex-shrink: 0;
    white-space: nowrap;
    color: color-mix(in oklab, var(--ui-text-highlighted) 60%, transparent);
}
</style>
