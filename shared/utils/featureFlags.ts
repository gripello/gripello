// Mirrored in pocketbase/hooks/features.go.
export const FEATURE_FLAGS = ['beta_videos'] as const

export type FeatureFlag = (typeof FEATURE_FLAGS)[number]

export type GymFeatures = Partial<Record<FeatureFlag, boolean>>

export function hasFeature(
    gym: { features?: GymFeatures | null } | null | undefined,
    flag: FeatureFlag,
) {
    return gym?.features?.[flag] === true
}
