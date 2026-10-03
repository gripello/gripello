<template>
    <section class="info-list" data-testid="me-info">
        <p class="native-heading">{{ $t('me.info') }}</p>
        <div class="native-group" style="--native-tint: #8e8e93">
            <NuxtLink
                v-bind="legalLinkProps(settings?.privacy_url, '/privacy')"
                class="native-row"
                data-testid="footer-privacy"
            >
                <span class="native-row__icon"
                    ><UIcon name="i-lucide-shield-check"
                /></span>
                <span class="native-row__text">{{ $t('legal.privacy') }}</span>
                <UIcon
                    name="i-lucide-chevron-right"
                    class="native-row__chevron"
                />
            </NuxtLink>
            <NuxtLink
                v-bind="legalLinkProps(settings?.imprint_url, '/imprint')"
                class="native-row"
                data-testid="footer-imprint"
            >
                <span class="native-row__icon"
                    ><UIcon name="i-lucide-scale"
                /></span>
                <span class="native-row__text">{{ $t('legal.imprint') }}</span>
                <UIcon
                    name="i-lucide-chevron-right"
                    class="native-row__chevron"
                />
            </NuxtLink>
            <NuxtLink
                v-if="gym?.slug"
                v-bind="legalLinkProps(gym.imprint_url, `/${gym.slug}/imprint`)"
                class="native-row"
                data-testid="me-gym-imprint"
            >
                <span class="native-row__icon"
                    ><UIcon name="i-lucide-building-2"
                /></span>
                <span class="native-row__text">{{
                    $t('legal.gymImprint', { name: gym.name })
                }}</span>
                <UIcon
                    name="i-lucide-chevron-right"
                    class="native-row__chevron"
                />
            </NuxtLink>
            <a
                v-if="settings?.contact_email"
                :href="`mailto:${settings.contact_email}`"
                class="native-row"
                data-testid="footer-contact"
            >
                <span class="native-row__icon"
                    ><UIcon name="i-lucide-mail"
                /></span>
                <span class="native-row__text">
                    <span class="block">{{ $t('settings.contactEmail') }}</span>
                    <span class="native-row__subtitle">{{
                        settings.contact_email
                    }}</span>
                </span>
            </a>
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
                        class="native-row"
                        data-testid="footer-version"
                    >
                        <span class="native-row__icon"
                            ><UIcon name="i-lucide-tag"
                        /></span>
                        <span class="native-row__text">
                            <span class="block">{{ $t('me.version') }}</span>
                            <span class="native-row__subtitle">{{
                                appVersionLabel
                            }}</span>
                        </span>
                        <UIcon
                            name="i-lucide-chevron-right"
                            class="native-row__chevron"
                        />
                    </button>
                </template>
            </NotificationsReleaseNotesDialog>
            <NotificationsUpdatePill v-slot="{ props: activatorProps }">
                <button
                    v-bind="activatorProps"
                    type="button"
                    class="native-row"
                    data-testid="footer-update"
                >
                    <span class="native-row__icon"
                        ><UIcon name="i-lucide-circle-arrow-up"
                    /></span>
                    <span class="native-row__text">{{
                        $t('notifications.updateAvailable')
                    }}</span>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="native-row__chevron"
                    />
                </button>
            </NotificationsUpdatePill>
            <div class="native-row" data-testid="footer-health">
                <span class="native-row__icon"
                    ><UIcon name="i-lucide-server"
                /></span>
                <span class="native-row__text">
                    <span class="block">{{ $t('me.status') }}</span>
                    <span class="native-row__subtitle info-list__status">
                        <span
                            class="info-list__dot"
                            :class="isHealthy ? 'info-list__dot--ok' : ''"
                        />
                        {{
                            isHealthy
                                ? $t('notifications.success.health')
                                : $t('notifications.error.health')
                        }}
                        · {{ $t('dashboard.online', [onlineCount]) }}
                    </span>
                </span>
            </div>
        </div>
        <a
            class="info-list__copyright"
            href="https://github.com/gripello/gripello"
            target="_blank"
            rel="noopener noreferrer"
        >
            © {{ new Date().getFullYear() }} Gripello
        </a>
    </section>
</template>

<script setup lang="ts">
import type { GymRecord, SettingsRecord } from '~/types/models'
import { legalLinkProps } from '~/utils/legal'

defineProps<{
    settings?: Partial<SettingsRecord> | null
    gym?: Partial<GymRecord> | null
}>()

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
const { isHealthy, onlineCount } = useAppStatus()
</script>

<style scoped>
.info-list__status {
    display: flex;
    align-items: center;
    gap: 6px;
}

.info-list__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ui-error);
}

.info-list__dot--ok {
    background: var(--ui-success);
}

.info-list__copyright {
    display: block;
    margin: 16px 0 8px;
    text-align: center;
    font-size: 0.75rem;
    color: var(--ui-text-dimmed);
    text-decoration: none;
}
</style>
