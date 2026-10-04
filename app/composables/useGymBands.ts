import { gymBandsFrom, type GymBand } from '#shared/utils/gradeReference'
import type { GymRecord } from '~/types/models'

export function useGymBands() {
    const { t } = useI18n()
    const { data: gym } = useNuxtData<GymRecord>('gym')
    const bands = computed(() => gymBandsFrom(gym.value?.boulder_bands))
    const bandName = (band: GymBand) =>
        band.name ?? t(`gradeConversion.bands.${band.key}`)
    return { bands, bandName }
}
