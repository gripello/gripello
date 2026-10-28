<template>
    <span class="grade-label" data-testid="grade-label">
        <span
            v-if="band"
            class="grade-label__band"
            :style="{ background: band.color }"
            role="img"
            :title="bandName(band)"
            :aria-label="bandName(band)"
            :data-band="band.key"
            data-testid="grade-label-band"
        />
        <span>{{ grade }}</span>
        <span
            v-if="system"
            class="grade-label__system"
            :title="$t(`gradeSystems.${system}`)"
            ><span aria-hidden="true">{{
                $t(`gradeSystemsShort.${system}`)
            }}</span
            ><span class="sr-only">{{
                $t(`gradeSystems.${system}`)
            }}</span></span
        >
    </span>
</template>

<script setup lang="ts">
import {
    formatGrade,
    isGradeSystem,
    type GradeSource,
} from '#shared/utils/grades'
import { gymBandFor } from '#shared/utils/gradeReference'

const props = defineProps<{
    source: (GradeSource & { type?: string | null }) | null | undefined
}>()

const gradeSystems = useGradeSystems()

const grade = computed(() => formatGrade(props.source))

const { bands, bandName } = useGymBands()
const band = computed(() => gymBandFor(props.source, bands.value))

const system = computed(() => {
    const value = props.source?.grade_system
    if (!grade.value || !isGradeSystem(value)) return null
    return gradeSystems.isUnexpectedSystem(props.source!) ? value : null
})
</script>

<style scoped>
.grade-label {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    white-space: nowrap;
}

.grade-label__band {
    align-self: center;
    width: 0.3em;
    min-width: 4px;
    height: 1.1em;
    border-radius: 999px;
    box-shadow: 0 0 0 1px
        color-mix(in oklab, var(--ui-text-highlighted) 15%, transparent);
}

.grade-label__system {
    font-size: 0.7em;
    font-weight: 500;
}
</style>
