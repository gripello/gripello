import { test, expect } from '../../support/fixtures'
import { ApiError, guestApi } from '../../support/api'

for (const [field, value] of [
    ['rating', -1000000],
    ['rating', 6],
    ['grade_index', 1e300],
] as const) {
    test(`an anonymous rating cannot store ${field} = ${value}`, async ({
        route,
    }) => {
        const error = await guestApi()
            .post(`/routes/${route.id}/ratings`, { rating: 3, [field]: value })
            .catch((error: unknown) => error)
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).status).toBe(400)
        expect((error as ApiError).response).toHaveProperty(['data', field])
    })
}
