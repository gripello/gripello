<template>
    <footer
        v-if="$route.meta.footer !== false"
        class="app-footer hidden lg:flex"
        data-testid="app-footer"
    >
        <div class="footer-inner">
            <!-- Left: legal links -->
            <div class="footer-left">
                <UButton
                    v-bind="
                        legalLinkProps(
                            settings.privacy_url,
                            `${gymBase}/privacy`,
                        )
                    "
                    variant="link"
                    color="neutral"
                    class="px-1.5 text-[13px] font-medium text-muted hover:text-highlighted"
                    data-testid="footer-privacy"
                >
                    {{ $t('legal.privacy') }}
                </UButton>

                <span class="link-sep">·</span>

                <UButton
                    v-bind="
                        legalLinkProps(
                            settings.imprint_url,
                            `${gymBase}/imprint`,
                        )
                    "
                    variant="link"
                    color="neutral"
                    class="px-1.5 text-[13px] font-medium text-muted hover:text-highlighted"
                    data-testid="footer-imprint"
                >
                    {{ $t('legal.imprint') }}
                </UButton>

                <span v-if="settings.contact_email" class="link-sep">·</span>

                <UButton
                    v-if="settings.contact_email"
                    :href="`mailto:${settings.contact_email}`"
                    variant="link"
                    color="neutral"
                    class="px-1.5 text-[13px] font-medium text-muted hover:text-highlighted"
                    data-testid="footer-contact"
                >
                    {{ $t('settings.contactEmail') }}
                </UButton>
            </div>

            <!-- Center: status pills -->
            <div class="footer-center">
                <div class="status-pill">
                    <span
                        class="status-dot"
                        :class="isHealthy ? 'dot--ok' : 'dot--err'"
                    />
                    <span class="status-label" data-testid="footer-health">{{
                        isHealthy
                            ? $t('notifications.success.health')
                            : $t('notifications.error.health')
                    }}</span>
                </div>

                <div class="status-pill">
                    <UIcon name="i-lucide-users" class="size-[11px]" />
                    <span class="status-label">{{
                        $t('dashboard.online', [onlineCount])
                    }}</span>
                </div>

                <NotificationsReleaseNotesDialog
                    :tag="installedBase ? `v${installedBase}` : appVersionLabel"
                    :notes="installedNotes"
                    :published-at="installedPublishedAt"
                    :commits="installedCommits"
                    :repo-url="repoUrl"
                    :installed-version="appVersionLabel"
                    :error="error"
                    :loading="loading"
                    installed
                >
                    <template #activator="{ props: activatorProps }">
                        <button
                            v-bind="activatorProps"
                            type="button"
                            class="status-pill status-pill--link"
                            data-testid="footer-version"
                        >
                            <UIcon name="i-lucide-tag" class="size-[11px]" />
                            <span class="status-label">{{
                                appVersionLabel
                            }}</span>
                        </button>
                    </template>
                </NotificationsReleaseNotesDialog>

                <NotificationsUpdatePill v-slot="{ props: activatorProps }">
                    <button
                        v-bind="activatorProps"
                        type="button"
                        class="status-pill status-pill--link status-pill--update"
                        data-testid="footer-update"
                    >
                        <UIcon
                            name="i-lucide-circle-arrow-up"
                            class="size-[11px]"
                        />
                        <span class="status-label">{{
                            $t('notifications.updateAvailable')
                        }}</span>
                    </button>
                </NotificationsUpdatePill>
            </div>

            <!-- Right: copyright -->
            <div class="footer-right">
                <UButton
                    href="https://github.com/gripello/gripello"
                    target="_blank"
                    variant="link"
                    color="neutral"
                    class="text-[11.5px] font-medium text-muted hover:text-highlighted"
                >
                    © {{ currentYear }} Gripello
                </UButton>
            </div>
        </div>
    </footer>
</template>

<script setup lang="ts">
import type { GymRecord, SettingsRecord } from '~/types/models'
import { legalLinkProps } from '~/utils/legal'
const props = withDefaults(
    defineProps<{
        settings?: Partial<SettingsRecord> | Partial<GymRecord>
        gymSlug?: string
    }>(),
    { settings: () => ({}), gymSlug: '' },
)
const gymBase = computed(() => (props.gymSlug ? `/${props.gymSlug}` : ''))

const {
    appVersionLabel,
    installedNotes,
    installedBase,
    installedPublishedAt,
    installedCommits,
    repoUrl,
    error,
    loading,
} = useVersionCheck()
const currentYear = computed(() => new Date().getFullYear())

const { isHealthy, onlineCount } = useAppStatus()
</script>

<style scoped>
@reference "~/assets/css/main.css";

.app-footer {
    flex: 0 0 auto;
    background: transparent;
    border-top: 1px solid
        color-mix(in oklab, var(--ui-text-highlighted) 8%, transparent);
    padding: 0;
}

.footer-inner {
    width: 100%;
    max-width: 1280px;
    margin: 0 auto;
    padding: 10px 24px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
}

/* ── Left ───────────────────────────────────────────────── */
.footer-left {
    display: flex;
    align-items: center;
    gap: 2px;
}

/* ── Center ─────────────────────────────────────────────── */
.footer-center {
    display: flex;
    align-items: center;
    gap: 6px;
}

.status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 9px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-text-highlighted) 5%, transparent);
    border: 1px solid
        color-mix(in oklab, var(--ui-text-highlighted) 8%, transparent);
}

.status-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: color-mix(in oklab, var(--ui-text-highlighted) 55%, transparent);
    white-space: nowrap;
}

.status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}

.dot--ok {
    background: var(--ui-success);
    box-shadow: 0 0 0 2px
        color-mix(in oklab, var(--ui-success) 20%, transparent);
}

.dot--err {
    background: var(--ui-error);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--ui-error) 20%, transparent);
}

/* ── Right ──────────────────────────────────────────────── */
.footer-right {
    display: flex;
    justify-content: flex-end;
}

/* ── Shared button styles ───────────────────────────────── */

.link-sep {
    font-size: 13px;
    color: color-mix(in oklab, var(--ui-text-highlighted) 35%, transparent);
    user-select: none;
}

.status-pill--link {
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s ease;
    font: inherit;
    appearance: none;
}

.status-pill--link:hover {
    background: color-mix(in oklab, var(--ui-text-highlighted) 9%, transparent);
    border-color: color-mix(
        in oklab,
        var(--ui-text-highlighted) 18%,
        transparent
    );
}

.status-pill--update,
.status-pill--update .status-label {
    color: var(--ui-primary);
}

.status-pill--update {
    background: color-mix(in oklab, var(--ui-primary) 10%, transparent);
    border-color: color-mix(in oklab, var(--ui-primary) 25%, transparent);
}

@variant max-sm {
    .footer-inner {
        grid-template-columns: 1fr;
        padding: 8px 16px;
        gap: 6px;
    }

    .footer-center {
        flex-wrap: wrap;
        justify-content: center;
        gap: 4px;
    }

    .footer-right {
        justify-content: center;
    }

    .footer-left {
        justify-content: center;
    }
}
</style>
