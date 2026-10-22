import { createError, eventHandler, getQuery, setResponseHeaders } from 'h3'
import { apiFetch, fetchFile } from '../../utils/api-server'
import {
    attachmentHeader,
    pdfBuffer,
    resolveApplicationUrl,
} from '../../utils/export'
import {
    drawGradeScalePdf,
    translator,
    type GradeScaleKind,
} from '../../utils/gradeScalePdf'
import { gymBandsFrom } from '#shared/utils/gradeReference'
import { DEFAULT_LOCALE, isLocaleCode } from '../../../app/utils/locales'
import type { GymRecord } from '../../../types/models'

export default eventHandler(async (event) => {
    const query = getQuery(event)
    const gymId = typeof query.gym === 'string' ? query.gym : ''
    const kind: GradeScaleKind = query.kind === 'routes' ? 'routes' : 'boulders'

    const api = apiFetch()
    const gym = gymId
        ? await api<GymRecord>(`/gyms/${gymId}`).catch(() => null)
        : null
    if (!gym) throw createError({ statusCode: 404, statusMessage: 'No gym.' })

    const language = isLocaleCode(gym.language) ? gym.language : DEFAULT_LOCALE
    const messages = await useStorage('assets:locales').getItem<object>(
        `${language}.json`,
    )
    if (!messages) throw new Error('Locale messages missing')
    const t = translator(messages)
    try {
        const { default: PDFDocument } = await import('pdfkit')
        const fonts = useStorage('assets:server')
        const [regularFont, boldFont] = await Promise.all([
            fonts.getItemRaw<Buffer>('fonts/Roboto-Regular.ttf'),
            fonts.getItemRaw<Buffer>('fonts/Roboto-Bold.ttf'),
        ])
        if (!regularFont || !boldFont) throw new Error('PDF fonts missing')

        const doc = new PDFDocument({
            size: 'A4',
            margin: 0,
        })
        doc.registerFont('Sans', Buffer.from(regularFont))
        doc.registerFont('Sans-Bold', Buffer.from(boldFont))

        const title = t(`gradeConversion.${kind}`)
        const logoFile = gym.sign_image || gym.page_logo
        const logo = logoFile
            ? await fetchFile(api, 'gyms', gym, logoFile)
            : null
        const footer = `${resolveApplicationUrl(event).replace(/^https?:\/\//, '')}/${gym.slug}`
        const pdf = await pdfBuffer(doc, () =>
            drawGradeScalePdf(doc, {
                kind,
                title,
                gymName: gym.name,
                unitName: gym.unit_name ?? '',
                footer,
                logo,
                bands: kind === 'routes' ? [] : gymBandsFrom(gym.boulder_bands),
                t,
            }),
        )
        setResponseHeaders(event, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': attachmentHeader(`${gym.name} ${title}.pdf`),
            'Cache-Control': 'no-store',
        })
        return pdf
    } catch (error) {
        console.error(error)
        throw createError({ statusCode: 500, statusMessage: 'Server error' })
    }
})
