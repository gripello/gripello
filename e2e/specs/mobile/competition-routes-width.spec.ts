import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('competition route rows and tabs keep their labels readable on a phone', async ({
    setterPage,
    root,
    workerLocation,
    createRoute,
    testPrefix,
}) => {
    const competition = await root.collection('competitions').create({
        name: `${testPrefix} Phone Cup`,
        location: workerLocation.id,
        status: 'draft',
        starts_at: '2030-12-10 10:00:00.000Z',
        ends_at: '2030-12-10 14:00:00.000Z',
        discipline: 'rope',
        scoring_format: 'route_points',
    })
    const rope = await createRoute({ name: `${testPrefix} Nordwand` })
    await root.collection('competition_routes').create({
        competition: competition.id,
        route: rope.id,
        number: 1,
        points: 1,
        hold_count: 30,
    })

    await setterPage.setViewportSize({ width: 393, height: 852 })
    await gotoSettled(
        setterPage,
        `/manage/competitions/${competition.id}`,
        /\/manage\/competition/,
    )
    const row = setterPage.getByTestId('competition-route-1')
    await expect(row).toContainText(rope.name)

    const nameColumnShare = await row
        .getByText(rope.name)
        .evaluate(
            (element) =>
                element.closest('.flex-1')!.getBoundingClientRect().width /
                element.closest('li')!.getBoundingClientRect().width,
        )
    expect(nameColumnShare).toBeGreaterThan(0.5)

    const middleOf = async (testId: string) => {
        const box = await setterPage.getByTestId(testId).boundingBox()
        return box!.y + box!.height / 2
    }
    const deleteMiddle = await middleOf('competition-route-delete-1')
    expect(
        Math.abs(deleteMiddle - (await middleOf('competition-route-points-1'))),
    ).toBeLessThanOrEqual(3)

    const clipped = await setterPage.evaluate(() =>
        [
            ...document.querySelectorAll(
                '[data-testid="competition-tabs"] [role="tab"] span',
            ),
        ]
            .filter((element) => element.scrollWidth > element.clientWidth)
            .map((element) => element.textContent),
    )
    expect(clipped).toEqual([])
})
