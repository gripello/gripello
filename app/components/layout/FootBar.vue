<template>
    <footer
        class="flex items-center gap-1 text-xs text-muted"
        :class="collapsed ? 'justify-center' : 'ps-2.5'"
        data-testid="app-footer"
    >
        <template v-if="!collapsed">
            <UChip
                :color="isHealthy ? 'success' : 'error'"
                standalone
                inset
                size="sm"
                :title="`${healthLabel} · ${onlineLabel}`"
            />
            <LayoutLegalLinks
                :settings="settings"
                :gym-slug="gymSlug"
                class="min-w-0 grow ps-1.5"
            />
            <NotificationsUpdatePill v-slot="{ props: activatorProps }">
                <UButton
                    v-bind="activatorProps"
                    icon="i-lucide-circle-arrow-up"
                    color="primary"
                    variant="ghost"
                    size="sm"
                    class="icon-btn"
                    :aria-label="$t('notifications.updateAvailable')"
                    data-testid="footer-update"
                />
            </NotificationsUpdatePill>
        </template>
        <UDropdownMenu
            :items="menuItems"
            :content="
                collapsed
                    ? { side: 'right', align: 'end' }
                    : { side: 'top', align: 'end' }
            "
            :ui="{ content: 'min-w-56', label: 'font-normal' }"
            :external-icon="false"
        >
            <UButton
                :icon="collapsed ? 'i-lucide-scale' : 'i-lucide-info'"
                color="neutral"
                variant="ghost"
                size="sm"
                class="icon-btn"
                :aria-label="collapsed ? $t('legal.imprint') : appVersionLabel"
                data-testid="footer-info"
            />
            <template #status>
                <span class="flex items-center gap-2 text-muted">
                    <UChip
                        :color="isHealthy ? 'success' : 'error'"
                        standalone
                        inset
                        size="sm"
                    />
                    <span data-testid="footer-health">{{ healthLabel }}</span>
                    <span aria-hidden="true">·</span>
                    {{ onlineLabel }}
                </span>
            </template>
            <template #version-label>
                <span class="tabular-nums" data-testid="footer-version">{{
                    appVersionLabel
                }}</span>
            </template>
            <template #contact-label>
                <span data-testid="footer-contact">{{
                    $t('settings.contactEmail')
                }}</span>
            </template>
        </UDropdownMenu>
        <NotificationsReleaseNotesDialog
            v-model:open="releaseNotesOpen"
            :tag="installedBase ? `v${installedBase}` : appVersionLabel"
            :notes="installedNotes"
            :published-at="installedPublishedAt"
            :commits="installedCommits"
            :repo-url="repoUrl"
            :installed-version="appVersionLabel"
            :error="error"
            :loading="loading"
            installed
        />
    </footer>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { GymRecord, SettingsRecord } from '~/types/models'
import { legalLinkProps } from '~/utils/legal'
const props = withDefaults(
    defineProps<{
        settings?: Partial<SettingsRecord> | Partial<GymRecord>
        gymSlug?: string
        collapsed?: boolean
    }>(),
    { settings: () => ({}), gymSlug: '', collapsed: false },
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
const { t } = useI18n()
const onlineLabel = computed(() => t('dashboard.online', [onlineCount.value]))
const healthLabel = computed(() =>
    isHealthy.value
        ? t('notifications.success.health')
        : t('notifications.error.health'),
)
const releaseNotesOpen = ref(false)

const menuItems = computed<DropdownMenuItem[][]>(() => [
    ...(props.collapsed
        ? [
              [
                  {
                      label: t('legal.imprint'),
                      icon: 'i-lucide-scale',
                      ...legalLinkProps(
                          props.settings.imprint_url,
                          `${gymBase.value}/imprint`,
                      ),
                  },
                  {
                      label: t('legal.privacy'),
                      icon: 'i-lucide-shield-check',
                      ...legalLinkProps(
                          props.settings.privacy_url,
                          `${gymBase.value}/privacy`,
                      ),
                  },
              ],
          ]
        : []),
    [
        { type: 'label', slot: 'status' as const },
        {
            label: appVersionLabel.value,
            icon: 'i-lucide-tag',
            slot: 'version' as const,
            onSelect: () => (releaseNotesOpen.value = true),
        },
        ...(props.settings.contact_email
            ? [
                  {
                      label: t('settings.contactEmail'),
                      icon: 'i-lucide-mail',
                      slot: 'contact' as const,
                      href: `mailto:${props.settings.contact_email}`,
                  },
              ]
            : []),
    ],
    [
        {
            label: `© ${currentYear.value} Gripello`,
            href: 'https://github.com/gripello/gripello',
            target: '_blank',
            class: 'text-xs text-muted',
        },
    ],
])
</script>
