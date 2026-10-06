<template>
    <div class="relative pb-14" data-testid="profile-images">
        <input
            ref="bannerInput"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            class="hidden"
            data-testid="profile-banner-input"
            @change="pick($event, 'banner')"
        />
        <input
            ref="avatarInput"
            type="file"
            accept="image/jpeg,image/png,image/svg+xml,image/webp"
            class="hidden"
            data-testid="profile-avatar-input"
            @change="pick($event, 'avatar')"
        />
        <button
            type="button"
            class="relative block h-28 w-full overflow-hidden rounded-2xl ring ring-default sm:h-40"
            :aria-label="$t('account.changeBanner')"
            data-testid="profile-banner-upload"
            @click="bannerInput?.click()"
        >
            <ClimberBanner
                :banner="banner"
                :avatar="avatar"
                :name="name"
                class="size-full"
            />
            <span
                class="absolute end-3 bottom-3 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur"
            >
                <UIcon name="i-lucide-image" class="size-4" />
                {{ $t('account.changeBanner') }}
            </span>
        </button>
        <UButton
            v-if="banner"
            icon="i-lucide-trash-2"
            color="neutral"
            variant="solid"
            class="icon-btn absolute end-3 top-3"
            :aria-label="$t('settings.removeImage')"
            data-testid="profile-banner-remove"
            @click="emit('removeBanner')"
        />
        <button
            type="button"
            class="absolute start-4 bottom-0 rounded-full ring-4 ring-(--ui-bg-elevated) sm:start-6"
            :aria-label="$t('account.changeAvatar')"
            data-testid="profile-avatar-upload"
            @click="avatarInput?.click()"
        >
            <UAvatar
                :src="avatar || undefined"
                :text="initials"
                :icon="initials ? undefined : 'i-lucide-user'"
                class="size-24 text-3xl font-bold"
                :class="avatar ? undefined : 'bg-primary'"
                :ui="{ fallback: 'text-inverted', icon: 'text-inverted' }"
            />
            <span
                class="absolute end-0 bottom-0 flex size-8 items-center justify-center rounded-full bg-primary text-inverted ring-2 ring-(--ui-bg-elevated)"
            >
                <UIcon name="i-lucide-camera" class="size-4" />
            </span>
        </button>
        <p
            class="absolute start-32 end-0 bottom-2 truncate text-lg font-bold text-highlighted sm:start-36"
        >
            {{ name }}
        </p>
    </div>
</template>

<script setup lang="ts">
import { nameInitials } from '~/utils/avatar'

const props = defineProps<{
    banner: string | null
    avatar: string | null
    name: string
}>()
const emit = defineEmits<{
    banner: [file: File]
    avatar: [file: File]
    removeBanner: []
}>()

const bannerInput = useTemplateRef<HTMLInputElement>('bannerInput')
const avatarInput = useTemplateRef<HTMLInputElement>('avatarInput')
const initials = computed(() => nameInitials(props.name) || undefined)

function pick(event: Event, kind: 'banner' | 'avatar') {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
        if (kind === 'banner') emit('banner', file)
        else emit('avatar', file)
    }
    input.value = ''
}
</script>
