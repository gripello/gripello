import { describe, expect, it } from 'vitest'
import {
    nearestColorName,
    nearestColors,
    renamedForColor,
} from '~/utils/colorName'

describe('nearestColorName', () => {
    it.each([
        ['#e53935', 'red'],
        ['#f44336', 'red'],
        ['#ff9800', 'orange'],
        ['#ffeb3b', 'yellow'],
        ['#fdd835', 'yellow'],
        ['#43a047', 'green'],
        ['#8bc34a', 'lime'],
        ['#1e88e5', 'blue'],
        ['#3f51b5', 'blue'],
        ['#8e24aa', 'purple'],
        ['#ec407a', 'pink'],
        ['#ff69b4', 'pink'],
        ['#6d4c41', 'brown'],
        ['#000', 'black'],
        ['#fff', 'white'],
        ['#fafafa', 'white'],
        ['#9e9e9e', 'grey'],
        ['#00bcd4', 'turquoise'],
        ['#26a69a', 'teal'],
        ['#00acc1', 'turquoise'],
        ['#009688', 'teal'],
        ['#795548', 'brown'],
        ['#a0522d', 'brown'],
        ['#da5307', 'orange'],
        ['#ff5722', 'orange'],
        ['#d32f2f', 'red'],
        ['#8b0000', 'darkRed'],
        ['#2196f3', 'blue'],
        ['#03a9f4', 'blue'],
        ['#673ab7', 'purple'],
        ['#9c27b0', 'purple'],
        ['#e91e63', 'pink'],
        ['#212121', 'black'],
        ['#ffffff', 'white'],
        ['#cfcfcf', 'lightGrey'],
        ['#ffc107', 'yellow'],
        ['#4caf50', 'green'],
        ['#f8bbd0', 'lightPink'],
        ['#b3e5fc', 'lightBlue'],
        ['#c8e6c9', 'mint'],
        ['#90caf9', 'lightBlue'],
        ['#a5d6a7', 'mint'],
        ['#c6ff00', 'lime'],
        ['#ff00ff', 'magenta'],
        ['#1a237e', 'navy'],
        ['#f5f5dc', 'beige'],
        ['#424242', 'darkGrey'],
        ['#827717', 'olive'],
        ['#1b5e20', 'darkGreen'],
        ['#b39ddb', 'lavender'],
        ['#4572a8', 'blue'],
        ['#ffa500', 'orange'],
    ])('names %s as %s', (hex, name) => {
        expect(nearestColorName(hex)).toBe(name)
    })

    it('returns null without a usable colour', () => {
        expect(nearestColorName(null)).toBeNull()
        expect(nearestColorName('not a colour')).toBeNull()
    })
})

describe('renamedForColor', () => {
    const t = (key: string) => key.replace('colors.', '')

    it('follows the colour while the name is empty or automatic', () => {
        expect(renamedForColor(t, '', '#888888', '#22c55e')).toBe('green')
        expect(renamedForColor(t, 'yellow', '#facc15', '#2563eb')).toBe('blue')
    })

    it('keeps a name the user typed', () => {
        expect(renamedForColor(t, 'Beginner', '#facc15', '#2563eb')).toBe(
            'Beginner',
        )
    })
})

describe('nearestColors', () => {
    it('orders by perceptual distance and leaves the target out', () => {
        expect(
            nearestColors(
                '#f44336',
                ['#F44336', '#2196F3', '#E91E63', '#FF9800'],
                2,
            ),
        ).toEqual(['#E91E63', '#FF9800'])
    })

    it('returns nothing for an unreadable target', () => {
        expect(nearestColors('nope', ['#FFFFFF'], 3)).toEqual([])
    })
})
