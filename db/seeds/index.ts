// import { seedUsers } from "./users"
// import { seedWallets } from "./wallets"
// import { seedExchangeRequests } from "./exchangeRequests"
// import { seedSubscriptions } from "./subscriptions"
// import { seedTransactions } from "./transactions"
import { seedNetworks } from "./networks"

const seed = async () => {
  await seedNetworks()
  // await seedUsers()
  // await seedMappings()
  // await seedWallets()
  // await seedExchangeRequests()
  // await seedSubscriptions()
  // await seedTransactions()
}

export default seed
