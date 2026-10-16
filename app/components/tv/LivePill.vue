<template>
    <span
        class="inline-flex items-center gap-2 rounded-full bg-error/15 px-3 py-1 text-sm font-bold tracking-wider text-error uppercase"
    >
        <span class="relative flex size-2.5">
            <span
                class="absolute inline-flex size-full animate-ping rounded-full bg-error opacity-75"
            />
            <span class="relative inline-flex size-2.5 rounded-full bg-error" />
        </span>
        {{ $t('competitions.tv.live') }}
    </span>
</template>
