<template>
    <div />
</template>

<script setup lang="ts">
import type { GymRecord, RouteRecord } from '~/types/models'

const pb = usePocketbase()
const route = useRoute()
const routeId = String(route.query.id ?? '')

const target = routeId
    ? await pb
          .collection('routes')
          .getOne<RouteRecord & { expand?: { gym?: GymRecord } }>(routeId, {
              fields: 'expand.gym.slug',
              expand: 'gym',
              requestKey: null,
          })
          .then((record) => record.expand?.gym?.slug)
          .catch(() => undefined)
    : undefined

if (!target) throw createError({ statusCode: 404, fatal: true })

await navigateTo(
    { path: `/${target}/route`, query: route.query, hash: route.hash },
    { replace: true, redirectCode: 302 },
)
</script>
