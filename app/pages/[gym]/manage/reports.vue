<template>
    <div />
</template>

<script setup lang="ts">
const gymPath = useGymPath()
await navigateTo(gymPath('/manage/moderation'), {
    redirectCode: 301,
    replace: true,
})
</script>
