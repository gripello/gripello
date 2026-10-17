<template>
    <!-- Safari 26 tints its top bar only from a full-width fixed element; beside the sidebar the header isn't one. -->
    <div
        class="pointer-events-none fixed inset-x-0 top-0 z-50 hidden h-1.5 bg-default opacity-0 lg:block"
        aria-hidden="true"
        data-testid="top-edge"
    />
</template>
