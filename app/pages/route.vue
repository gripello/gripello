<template>
    <div />
</template>

<script setup lang="ts">
import { getRoute } from '~/api/routes'
import type { GymRecord, RouteRecord } from '~/types/models'

const route = useRoute()
const routeId = String(route.query.id ?? '')

const target = routeId
    ? await getRoute<RouteRecord & { expand?: { gym?: GymRecord } }>(
          routeId,
          ['gym'],
          { fields: 'expand.gym.slug', requestKey: null },
      )
          .then((record) => record.expand?.gym?.slug)
          .catch(() => undefined)
    : undefined

if (!target) throw createError({ statusCode: 404, fatal: true })

await navigateTo(
    { path: `/${target}/route`, query: route.query, hash: route.hash },
    { replace: true, redirectCode: 302 },
)
</script>
