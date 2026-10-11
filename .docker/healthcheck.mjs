const urls = [
    'http://127.0.0.1:8080/api/health',
    'http://127.0.0.1:3000/',
    'http://127.0.0.1/',
]

try {
    await Promise.all(
        urls.map(async (url) => {
            const response = await fetch(url, { redirect: 'manual' })
            if (response.status >= 400)
                throw new Error(`${url} ${response.status}`)
        }),
    )
} catch (error) {
    console.error(error.message)
    process.exit(1)
}
// fetch keeps idle keep-alive sockets open for ~4 s, which would push the check past its 5 s timeout
process.exit(0)
