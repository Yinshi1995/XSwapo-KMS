// import { seedUsers } from "./users"
// import { seedWallets } from "./wallets"
// import { seedExchangeRequests } from "./exchangeRequests"
// import { seedTransactions } from "./transactions"
// import { seedNetworks } from "./networks"
import { seedKucoinChains } from "./update-kucoin-chains"

const seed = async () => {
  // await seedNetworks()
  // await seedUsers()
  // await seedMappings()
  // await seedWallets()
  // await seedExchangeRequests()
  // await seedTransactions()
  await seedKucoinChains()
}

export default seed
