<template>
    <UAlert
        v-if="outdated"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="
            native
                ? $t('outdatedBrowser.webview')
                : $t('outdatedBrowser.browser')
        "
        :actions="
            native
                ? [
                      {
                          label: $t('outdatedBrowser.update'),
                          to: WEBVIEW_STORE_URL,
                          target: '_blank',
                      },
                  ]
                : []
        "
        class="mx-4 mt-4 w-auto"
        data-testid="outdated-browser"
    />
</template>

<script setup lang="ts">
import {
    WEBVIEW_STORE_URL,
    isNativeApp,
    rendersModernCss,
} from '~/utils/native'

const outdated = ref(false)
const native = ref(false)

onMounted(() => {
    outdated.value = !rendersModernCss(globalThis.CSS)
    native.value = isNativeApp()
})
</script>
