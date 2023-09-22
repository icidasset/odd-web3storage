import { Components, Configuration } from "@oddjs/odd"
import * as Config from "@oddjs/odd"

import * as Account from "./components/account.js"
import * as Agent from "@oddjs/odd/components/agent/web-crypto-api"
import * as Authority from "@oddjs/odd/components/authority/browser-url"
import * as Channel from "@oddjs/odd/components/channel/local-first-relay"
import * as Clerk from "./components/clerk.js"
import * as Depot from "./components/depot.js"
import * as DNS from "@oddjs/odd/components/dns/dns-over-https/cloudflare-google"
import * as Identifier from "@oddjs/odd/components/identifier/web-crypto-api"
import * as Manners from "@oddjs/odd/components/manners/default"
import * as Storage from "@oddjs/odd/components/storage/indexed-db"

export { Annex } from "./components/account.js"

/**
 * The web3storage stack.
 *
 * @group 🚀
 */
export async function components(
  settings: Configuration & {
    environment?: string
  }
): Promise<
  Components<
    Account.Annex,
    Authority.ProvideResponse,
    Authority.RequestResponse
  >
> {
  const config = Config.extract(settings)
  const namespace = Config.namespace(config)

  // Collect components
  const storage = Storage.implementation({ name: namespace })
  const agentStore = Storage.implementation({ name: `${namespace}/agent` })
  const identifierStore = Storage.implementation({ name: `${namespace}/identifier` })

  const agent = await Agent.implementation({ store: agentStore })
  const depot = await Depot.implementation({ agent, storage, blockstoreName: `${namespace}/blockstore` })

  const clerk = Clerk.implementation()
  const dns = DNS.implementation()
  const identifier = await Identifier.implementation({ store: identifierStore })
  const manners = Manners.implementation(config)
  const account = Account.implementation({ agent, manners })
  const authority = Authority.implementation()
  const channel = Channel.implementation(manners, identifier.did(), "wss://salt-somber-magpie.glitch.me")

  // Fin
  return {
    account,
    agent,
    authority,
    channel,
    clerk,
    depot,
    dns,
    identifier,
    manners,
    storage,
  }
}
