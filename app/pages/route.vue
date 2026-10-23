<template>
    <div />
</template>

<script setup lang="ts">
import { getRoute } from '~/api/routes'
import { nullIfNotFound } from '~/utils/errors'
import type { GymRecord, RouteRecord } from '~/types/models'

const route = useRoute()
const routeId = String(route.query.id ?? '')

const target = routeId
    ? await nullIfNotFound(
          getRoute<RouteRecord & { expand?: { gym?: GymRecord } }>(routeId, [
              'gym',
          ]),
      ).then(
          (record) => record?.expand?.gym?.slug,
          (error: { status?: number }) => {
              throw createError({ status: error.status || 503, fatal: true })
          },
      )
    : undefined

if (!target) throw createError({ statusCode: 404, fatal: true })

await navigateTo(
    { path: `/${target}/route`, query: route.query, hash: route.hash },
    { replace: true, redirectCode: 302 },
)
</script>
