export function useOrgSettings() {
    const { gym } = useGym()
    const { data: settings } = useSettingsRecord()

    return {
        orgName: computed(() => gym.value?.name || ''),
        orgUnitName: computed(() => gym.value?.unit_name || ''),
        allowRegistration: computed(() => !!settings.value?.allow_registration),
    }
}
