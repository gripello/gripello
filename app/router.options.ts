import type { RouterConfig } from 'nuxt/schema'
import { createWebHistory } from 'vue-router'
import { listenBeforeRouter } from '~/utils/dialogHistory'

export default {
    history: (base) => {
        if (!import.meta.client) return null
        listenBeforeRouter()
        return createWebHistory(base)
    },
} satisfies RouterConfig
