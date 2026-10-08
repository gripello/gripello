<template>
    <div class="flex flex-col gap-3" data-testid="competition-categories">
        <div
            v-for="(row, index) in rows"
            :key="row.id ?? `new-${index}`"
            class="grid grid-cols-2 items-end gap-3 rounded-lg bg-default p-3 ring ring-default sm:grid-cols-[2fr_1fr_1fr_1fr_auto]"
            :data-testid="`competition-category-${index}`"
        >
            <UFormField
                :label="$t('competitions.categoryName')"
                class="col-span-2 sm:col-span-1"
            >
                <UInput
                    v-model="row.name"
                    class="w-full"
                    :data-testid="`competition-category-name-${index}`"
                />
            </UFormField>
            <UFormField :label="$t('competitions.gender')">
                <USelect
                    v-model="row.gender"
                    :items="genderItems"
                    class="w-full"
                    :data-testid="`competition-category-gender-${index}`"
                />
            </UFormField>
            <UFormField :label="$t('competitions.bornFrom')">
                <UInputNumber
                    v-model="row.min_birth_year"
                    :min="1900"
                    :max="currentYear"
                    :format-options="{ useGrouping: false }"
                    class="w-full"
                    :data-testid="`competition-category-min-${index}`"
                />
            </UFormField>
            <UFormField :label="$t('competitions.bornTo')">
                <UInputNumber
                    v-model="row.max_birth_year"
                    :min="1900"
                    :max="currentYear"
                    :format-options="{ useGrouping: false }"
                    class="w-full"
                    :data-testid="`competition-category-max-${index}`"
                />
            </UFormField>
            <div class="col-span-2 flex justify-end gap-1 sm:col-span-1">
                <UButton
                    icon="i-lucide-check"
                    color="primary"
                    variant="soft"
                    class="icon-btn"
                    :aria-label="$t('actions.save')"
                    :disabled="!row.name.trim()"
                    :loading="savingIndex === index"
                    :data-testid="`competition-category-save-${index}`"
                    @click="save(index)"
                />
                <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    class="icon-btn"
                    :aria-label="$t('actions.delete')"
                    :data-testid="`competition-category-delete-${index}`"
                    @click="remove(index)"
                />
            </div>
        </div>

        <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="soft"
            class="self-start"
            data-testid="competition-category-add"
            @click="add"
        >
            {{ $t('competitions.addCategory') }}
        </UButton>
    </div>
</template>

<script setup lang="ts">
import type { CompetitionCategoryRecord } from '~/types/models'

const ANY_GENDER = 'any'

interface CategoryRow {
    id?: string
    name: string
    gender: string
    min_birth_year?: number
    max_birth_year?: number
}

const props = defineProps<{ competitionId: string }>()

const emit = defineEmits<{ changed: [] }>()

const pb = usePocketbase()
const { t } = useI18n()
const { run } = useAsyncAction()

const currentYear = new Date().getFullYear()
const rows = ref<CategoryRow[]>([])
const savingIndex = ref<number | null>(null)

const genderItems = computed(() => [
    { value: ANY_GENDER, label: t('competitions.genders.any') },
    { value: 'female', label: t('competitions.genders.female') },
    { value: 'male', label: t('competitions.genders.male') },
])

const { data: categories, refresh } = useAsyncData(
    () => `competition-categories:${props.competitionId}`,
    () =>
        pb
            .collection('competition_categories')
            .getFullList<CompetitionCategoryRecord>({
                filter: pb.filter('competition = {:id}', {
                    id: props.competitionId,
                }),
                sort: 'sort,name',
            }),
)

watch(
    categories,
    (records) => {
        rows.value = (records ?? []).map((category) => ({
            id: category.id,
            name: category.name,
            gender: category.gender || ANY_GENDER,
            min_birth_year: category.min_birth_year || undefined,
            max_birth_year: category.max_birth_year || undefined,
        }))
    },
    { immediate: true },
)

function add() {
    rows.value.push({ name: '', gender: ANY_GENDER })
}

async function save(index: number) {
    const row = rows.value[index]
    if (!row) return
    const body = {
        competition: props.competitionId,
        name: row.name.trim(),
        gender: row.gender === ANY_GENDER ? '' : row.gender,
        min_birth_year: row.min_birth_year ?? 0,
        max_birth_year: row.max_birth_year ?? 0,
        sort: index + 1,
    }
    savingIndex.value = index
    await run(
        async () => {
            const collection = pb.collection('competition_categories')
            if (row.id) await collection.update(row.id, body)
            else await collection.create(body)
            await refresh()
            emit('changed')
        },
        { success: t('competitions.categorySaved') },
    )
    savingIndex.value = null
}

async function remove(index: number) {
    const row = rows.value[index]
    if (!row?.id) {
        rows.value.splice(index, 1)
        return
    }
    await run(
        async () => {
            await pb.collection('competition_categories').delete(row.id!)
            await refresh()
            emit('changed')
        },
        { error: t('competitions.categoryInUse') },
    )
}
</script>
