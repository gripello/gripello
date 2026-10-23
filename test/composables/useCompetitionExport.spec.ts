vi.mock('~/utils/download', () => ({ saveBlob: vi.fn() }))

describe('useCompetitionExport', () => {
    it("sends the viewer's time zone so dates match the gym", async () => {
        const fetchMock = vi.fn(async () => new Response('pdf'))
        vi.stubGlobal('fetch', fetchMock)
        vi.stubGlobal('useAuthStore', () => ({ token: '' }))
        vi.stubGlobal('useI18n', () => ({
            t: (key: string) => key,
            locale: { value: 'en' },
            loadLocaleMessages: async () => {},
        }))
        vi.stubGlobal('useAsyncAction', () => ({
            pending: { value: false },
            run: (action: () => Promise<unknown>) => action(),
        }))
        const { useCompetitionExport } =
            await import('~/composables/useCompetitionExport')

        await useCompetitionExport().download(
            { id: 'c1', name: 'Cup' },
            'results',
            'pdf',
        )

        const [, init] = fetchMock.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ]
        expect(JSON.parse(String(init.body)).timeZone).toBe(
            Intl.DateTimeFormat().resolvedOptions().timeZone,
        )
    })
})
