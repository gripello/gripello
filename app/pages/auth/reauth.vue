<script setup lang="ts">
import { finishOAuth2Reauth } from '~/api/auth'
import { REAUTH_CHANNEL, type ReauthMessage } from '~/utils/providerReauth'

definePageMeta({ layout: 'blank' })

const { t } = useI18n()
const route = useRoute()
useHead({ title: t('page.title.reauth') })

const state = ref<'pending' | 'confirmed' | 'failed'>('pending')

// The provider popup lands here; it redeems the ticket in this browser, tells the opener and closes.
onMounted(async () => {
    const ticket = route.query.oauth2Reauth
    let ok = false
    if (typeof ticket === 'string' && ticket) {
        ok = await finishOAuth2Reauth(ticket).then(
            () => true,
            () => false,
        )
    }
    state.value = ok ? 'confirmed' : 'failed'
    const channel = new BroadcastChannel(REAUTH_CHANNEL)
    channel.postMessage({ ok } satisfies ReauthMessage)
    channel.close()
    window.close()
})
</script>

<template>
    <div class="mx-auto flex min-h-dvh w-full items-center justify-center p-4">
        <LayoutEmptyState
            :variant="state === 'failed' ? 'error' : undefined"
            :icon="
                state === 'confirmed'
                    ? 'i-lucide-circle-check'
                    : state === 'failed'
                      ? 'i-lucide-circle-x'
                      : 'i-lucide-loader-circle'
            "
            :title="
                state === 'failed'
                    ? t('auth.reauth.failed')
                    : t('auth.reauth.confirmed')
            "
            data-testid="reauth-page"
            :data-state="state"
        />
    </div>
</template>
