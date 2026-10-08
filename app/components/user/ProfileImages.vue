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
            class="absolute start-4 bottom-0 rounded-full ring-4 ring-(--ui-bg) sm:start-6"
            :aria-label="$t('account.changeAvatar')"
            data-testid="profile-avatar-upload"
            @click="avatarInput?.click()"
        >
            <ClimberAvatar :id="userId" :src="avatar" :name="name" size="lg" />
            <span
                class="absolute end-0 bottom-0 flex size-8 items-center justify-center rounded-full bg-primary text-inverted ring-2 ring-(--ui-bg)"
            >
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
            :output-width="pending?.kind === 'banner' ? 1600 : 640"
            :round="pending?.kind === 'avatar'"
            :avatar-marker="pending?.kind === 'banner'"
            @cropped="onCropped"
            @cancel="pending = null"
        />
    </div>
</template>

<script setup lang="ts">
const BANNER_ASPECT = 4

defineProps<{
    banner: string | null
    avatar: string | null
    name: string
    userId?: string
}>()
const emit = defineEmits<{
    banner: [file: File]
    avatar: [file: File]
    removeBanner: []
}>()

const bannerInput = useTemplateRef<HTMLInputElement>('bannerInput')
const avatarInput = useTemplateRef<HTMLInputElement>('avatarInput')
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
