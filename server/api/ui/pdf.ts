import { eventHandler, createError, setResponseHeaders } from 'h3'
import { fetchFile, requirePermission } from '../../utils/api-server'
import {
    resolveRouteIds,
    requireRouteIds,
    pdfBuffer,
    MAX_TAG_ROUTES,
    resolveApplicationUrl,
    resolveExportGymId,
    fetchRoutesByIds,
    resolveExportLocale,
    resolveExportLabel,
    resolveExportShow,
    TAG_QR_ERROR_CORRECTION,
} from '../../utils/export'
import { drawRouteTag } from '../../utils/routeTag'
import { gymBandsFrom } from '#shared/utils/gradeReference'
import type { GymRecord } from '../../../types/models'

export default eventHandler(async (event) => {
    const { default: QRCode } = await import('qrcode')
    const { default: PDFDocument } = await import('pdfkit')
    const gymId = await resolveExportGymId(event)
    const api = await requirePermission(event, 'manage_routes', gymId)
    const ids = requireRouteIds(await resolveRouteIds(event), MAX_TAG_ROUTES)

    try {
        const gym = await api<GymRecord>(`/gyms/${gymId}`)

        const show = await resolveExportShow(event)
        let logo: Buffer | null = null
        if (gym.sign_image && show.logo) {
            logo = await fetchFile(api, 'gyms', gym, gym.sign_image)
        }

        const applicationUrl = resolveApplicationUrl(event)
        const bands = gymBandsFrom(gym.boulder_bands)
        const locale = await resolveExportLocale(event)
        const anchorLabel = await resolveExportLabel(event, 'anchor', 'Anchor')
        const fonts = useStorage('assets:server')
        const [regularFont, boldFont] = await Promise.all([
            fonts.getItemRaw<Buffer>('fonts/Roboto-Regular.ttf'),
            fonts.getItemRaw<Buffer>('fonts/Roboto-Bold.ttf'),
        ])
        if (!regularFont || !boldFont) throw new Error('PDF fonts missing')

        const QR_PX = 330

        const records = await fetchRoutesByIds(api, gymId, ids)
        const byId = new Map(records.map((record) => [record.id, record]))
        const routes = ids
            .map((id) => byId.get(id))
            .filter((route) => route !== undefined)

        const doc = new PDFDocument({ size: [595.28, 841.89] })
        doc.registerFont('Sans', Buffer.from(regularFont))
        doc.registerFont('Sans-Bold', Buffer.from(boldFont))
        doc.font('Sans')

        const pdf = await pdfBuffer(doc, async () => {
            for (const [index, route] of routes.entries()) {
                if (index % 8 === 0 && index > 0) doc.addPage()

                const qrCode = await QRCode.toBuffer(
                    `${applicationUrl}/route?id=${route.id}`,
                    {
                        errorCorrectionLevel: TAG_QR_ERROR_CORRECTION,
                        width: QR_PX,
                        margin: 1,
                        color: { dark: '#000000', light: '#FFFFFF' },
                    },
                )
                drawRouteTag(
                    doc,
                    route,
                    index % 2 === 0 ? 20 : 315,
                    (Math.floor(index / 2) % 4) * 193 + 30,
                    { anchorLabel, locale, qrCode, logo, show, bands },
                )
            }
        })
        setResponseHeaders(event, { 'Content-Type': 'application/pdf' })
        return pdf
    } catch (error) {
        console.error(error)
        throw createError({ statusCode: 500, statusMessage: 'Server error' })
    }
})
