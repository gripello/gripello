<script setup lang="ts">
const password = defineModel<string>({ default: '' })
</script>

<template>
    <UserPasswordField
        v-model="password"
        :label="$t('platform.users.adminPassword')"
        icon="i-lucide-shield-check"
    />
</template>
