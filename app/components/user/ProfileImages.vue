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
            class="relative block aspect-[4/1] max-h-60 w-full overflow-hidden rounded-lg ring ring-default"
            :aria-label="$t('account.changeBanner')"
            data-testid="profile-banner-upload"
            @click="bannerInput?.click()"
        >
            <ClimberBanner
                :banner="banner"
                :avatar="avatar"
                :name="name"
                :id="userId"
                class="size-full"
            />
        </button>
        <UDropdownMenu
            v-if="banner"
            :items="bannerMenu"
            :content="{ align: 'end' }"
        >
            <UButton
                icon="i-lucide-image"
                color="neutral"
                size="sm"
                class="absolute end-3 bottom-17 rounded-full"
                :label="$t('account.changeBanner')"
                data-testid="profile-banner-menu"
            />
        </UDropdownMenu>
        <UButton
            v-else
            icon="i-lucide-image"
            color="neutral"
            size="sm"
            class="absolute end-3 bottom-17 rounded-full"
            :label="$t('account.changeBanner')"
            tabindex="-1"
            aria-hidden="true"
            @click="bannerInput?.click()"
        />
        <UDropdownMenu v-if="avatarRemovable" :items="avatarMenu">
            <button
                type="button"
                class="absolute start-4 bottom-0 rounded-full ring-4 ring-(--ui-bg) sm:start-6"
                :aria-label="$t('account.changeAvatar')"
                data-testid="profile-avatar-upload"
            >
                <ClimberAvatar
                    :id="userId"
                    :src="avatar"
                    :name="name"
                    size="lg"
                />
                <span :class="AVATAR_BADGE">
                    <UIcon name="i-lucide-camera" class="size-4" />
                </span>
            </button>
        </UDropdownMenu>
        <button
            v-else
            type="button"
            class="absolute start-4 bottom-0 rounded-full ring-4 ring-(--ui-bg) sm:start-6"
            :aria-label="$t('account.changeAvatar')"
            data-testid="profile-avatar-upload"
            @click="avatarInput?.click()"
        >
            <ClimberAvatar :id="userId" :src="avatar" :name="name" size="lg" />
            <span :class="AVATAR_BADGE">
                <UIcon name="i-lucide-camera" class="size-4" />
            </span>
        </button>
        <p
            class="absolute start-32 end-0 bottom-2 truncate text-lg font-bold text-highlighted sm:start-36"
        >
            {{ name }}
        </p>
        <ImageCropDialog
            :file="pending?.file ?? null"
            :title="
                pending?.kind === 'banner'
                    ? $t('account.changeBanner')
                    : $t('account.changeAvatar')
            "
            :aspect="pending?.kind === 'banner' ? BANNER_ASPECT : 1"
            :output-width="pending?.kind === 'banner' ? 2400 : 640"
            :round="pending?.kind === 'avatar'"
            :avatar-marker="pending?.kind === 'banner'"
            @cropped="onCropped"
            @cancel="pending = null"
        />
    </div>
</template>

<script setup lang="ts">
const BANNER_ASPECT = 4
const AVATAR_BADGE =
    'absolute end-0 bottom-0 flex size-8 items-center justify-center rounded-full bg-primary text-inverted ring-2 ring-(--ui-bg)'

const props = defineProps<{
    banner: string | null
    avatar: string | null
    name: string
    userId?: string
    removableAvatar?: boolean
}>()
const emit = defineEmits<{
    banner: [file: File]
    avatar: [file: File]
    removeBanner: []
    removeAvatar: []
}>()

const bannerInput = useTemplateRef<HTMLInputElement>('bannerInput')
const avatarInput = useTemplateRef<HTMLInputElement>('avatarInput')

const { t } = useI18n()
const avatarRemovable = computed(() => props.removableAvatar && !!props.avatar)
const bannerMenu = computed(() => [
    {
        label: t('account.changeBanner'),
        icon: 'i-lucide-image',
        'data-testid': 'profile-banner-change',
        onSelect: () => bannerInput.value?.click(),
    },
    {
        label: t('account.removeBanner'),
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        'data-testid': 'profile-banner-remove',
        onSelect: () => emit('removeBanner'),
    },
])
const avatarMenu = computed(() => [
    {
        label: t('account.changeAvatar'),
        icon: 'i-lucide-camera',
        'data-testid': 'profile-avatar-change',
        onSelect: () => avatarInput.value?.click(),
    },
    {
        label: t('account.removeAvatar'),
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        'data-testid': 'profile-avatar-remove',
        onSelect: () => emit('removeAvatar'),
    },
])
const pending = shallowRef<{ kind: 'banner' | 'avatar'; file: File } | null>(
    null,
)

function pick(event: Event, kind: 'banner' | 'avatar') {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (file.type === 'image/svg+xml') emitImage(kind, file)
    else pending.value = { kind, file }
}

function onCropped(file: File) {
    if (pending.value) emitImage(pending.value.kind, file)
    pending.value = null
}

function emitImage(kind: 'banner' | 'avatar', file: File) {
    if (kind === 'banner') emit('banner', file)
    else emit('avatar', file)
}
</script>
