import {
    DEFAULT_BOULDER_GRADE_SYSTEM,
    DEFAULT_ROUTE_GRADE_SYSTEM,
    gradeLabels,
    isGradeSystem,
    type GradeSystem,
} from '#shared/utils/grades'
import type { GymRecord } from '~/types/models'

export function useGradeSystems() {
    const { t } = useI18n()
    const { data: gym } = useNuxtData<GymRecord>('gym')

    const routeGradeSystem = computed<GradeSystem>(() => {
        const value = gym.value?.route_grade_system
        return isGradeSystem(value) ? value : DEFAULT_ROUTE_GRADE_SYSTEM
    })
    const boulderGradeSystem = computed<GradeSystem>(() => {
        const value = gym.value?.boulder_grade_system
        return isGradeSystem(value) ? value : DEFAULT_BOULDER_GRADE_SYSTEM
    })

    function gradeSystemFor(type: string | null | undefined): GradeSystem {
        return type === 'Boulder'
            ? boulderGradeSystem.value
            : routeGradeSystem.value
    }

    const gradeFilterItems = computed(() =>
        [
            ...new Set([routeGradeSystem.value, boulderGradeSystem.value]),
        ].flatMap((system) =>
            gradeLabels(system).map((grade) => ({
                text: `${grade} · ${t(`gradeSystemsShort.${system}`)}`,
                value: `${system}:${grade}`,
            })),
        ),
    )

    const gradeColumnTitle = computed(
        () =>
            `${t('climbing.difficulty')} (${t(`gradeSystemsShort.${routeGradeSystem.value}`)} · ${t(`gradeSystemsShort.${boulderGradeSystem.value}`)})`,
    )

    function isUnexpectedSystem(source: {
        type?: string | null
        grade_system?: string | null
    }) {
        return (
            !!source.grade_system &&
            source.grade_system !== gradeSystemFor(source.type)
        )
    }

    return {
        gradeColumnTitle,
        isUnexpectedSystem,
        routeGradeSystem,
        boulderGradeSystem,
        gradeSystemFor,
        gradeFilterItems,
    }
}
