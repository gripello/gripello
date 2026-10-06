import { superuserClient } from './target.ts'

const pb = await superuserClient()

const gyms = (
    await pb.collection('gyms').getFullList({ filter: 'slug ~ "load-"' })
).filter((gym) => /^load-\d+$/.test(gym.slug))
for (const gym of gyms) await pb.collection('gyms').delete(gym.id)
console.log(`${gyms.length} gyms deleted`)

const users = (
    await pb.collection('users').getFullList({
        fields: 'id,email',
        filter: 'email ~ "load-%@gripello.test"',
    })
).filter((user) => /^load-\d+@gripello\.test$/.test(user.email))
for (let i = 0; i < users.length; i += 50) {
    const batch = pb.createBatch()
    for (const user of users.slice(i, i + 50)) {
        batch.collection('users').delete(user.id)
    }
    await batch.send()
}
console.log(`${users.length} users deleted`)
