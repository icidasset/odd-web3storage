import * as Client from "@web3-storage/w3up-client"

import { StoreMemory } from "@web3-storage/access/stores/store-memory"
import { Upload } from "@web3-storage/upload-client"

import { Account, Agent, Identifier, Manners, CID, FileSystemCarrier, Inventory, Ticket, Names } from "@oddjs/odd"
import { AccountQuery } from "@oddjs/odd/authority/query"

import {
  agentSigner,
  config,
  fromTicket,
  identifierSigner,
  ticketProofResolver,
  toTicket,
} from "../common.js"

////////
// 🏔️ //
////////

export const NAMES = {
  fileSystem(identifierDID: string) {
    return `ACCOUNT_FILE_SYSTEM_DID#${identifierDID}`
  },
}

////////
// 🧩 //
////////

export type Annex = {
  /**
   * Create a progressive volume for a Web3Storage space.
   *
   * This method can be used to load a local-only file system before a space is registered.
   * When you register the space, the file system will sync.
   */
  volume: () => Promise<FileSystemCarrier>
}

export type Dependencies<FS> = {
  agent: Agent.Implementation
  manners: Manners.Implementation<FS>
}

/////////////////
// FILE SYSTEM //
/////////////////

export async function volume<FS>(
  dependencies: Dependencies<FS>,
  identifier: Identifier.Implementation,
  inventory: Inventory,
  names: Names
): Promise<FileSystemCarrier> {
  const { agent } = dependencies
  const signerAgent = agentSigner(agent)

  // Data root updater
  const dataRootUpdater = async (dataRoot: CID, _proofs: Ticket[]): Promise<
    { updated: true } | { updated: false; reason: string }
  > => {
    const { suffices } = await hasSufficientAuthority(identifier, inventory)
    if (!suffices) return { updated: false, reason: "Not authenticated yet, lacking authority." }

    const result = await config(inventory, signerAgent)
    if (!result.config) throw new Error(result.error)
    const conf = result.config

    // Remove old uploads andadd data root as upload
    try {
      const { results } = await Upload.list(conf)

      await Promise.all(
        results.map(r => Upload.remove(conf, r.root))
      )

      await Upload.add(conf, dataRoot, [])
    } catch (error) {
      console.error(error)
      dependencies.manners.log("🔥 Failed to update DNSLink for:", dataRoot.toString())

      const reason = typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error && typeof error.message === "string"
          ? error.message
          : "unknown"

      return { updated: false, reason }
    }

    // Log
    dependencies.manners.log("🪴 DNSLink updated:", dataRoot.toString())

    // Fin
    return { updated: true }
  }

  const { suffices } = await hasSufficientAuthority(identifier, inventory)
  const identifierDID = identifier.did()

  if (!suffices) {
    const name = NAMES.fileSystem(identifierDID)
    const did = names.subject(name)

    return did
      ? { dataRootUpdater, id: { did } }
      : { dataRootUpdater, id: { name } }
  }

  // Find account-proof UCAN
  const spaceProof = await findSpaceProofTicket(identifierDID, inventory)

  if (!spaceProof) {
    throw new Error("Expected to find account proof")
  }

  const name = NAMES.fileSystem(spaceProof.audience)
  const did = names.subject(name)

  if (!did) {
    // futile, because a file system should not be loaded in this state.
    return { dataRootUpdater, futile: true, id: { name } }
  }

  if (!dependencies.manners.program.online()) {
    return {
      dataRoot: undefined,
      dataRootUpdater,
      id: { did },
    }
  }

  const conf = await config(inventory, signerAgent)
  if (conf.error || !conf.config) throw new Error(conf.error)

  const list = await Upload.list(conf.config).then(r => r.results)
  const dataRoot = list[0]
    ? CID.decode(list[0].root.bytes)
    : undefined

  return {
    dataRoot,
    dataRootUpdater,
    id: { did },
  }
}

//////////////
// CREATION //
//////////////

export async function canRegister(formValues: Record<string, string>): Promise<
  { canRegister: true } | { canRegister: false; reason: string }
> {
  const email = formValues.email?.trim()
  if (!email) {
    return {
      canRegister: false,
      reason: `Email is missing from the form values record`,
    }
  }

  return { canRegister: true }
}

export async function register(
  identifier: Identifier.Implementation,
  names: Names,
  formValues: Record<string, string>
): Promise<
  { registered: true; tickets: Ticket[] } | { registered: false; reason: string }
> {
  const form = await canRegister(formValues)
  if (!form.canRegister) {
    return {
      registered: false,
      reason: form.reason,
    }
  }

  // Create space and account
  const signer = identifierSigner(identifier)
  const client = await Client.create({ principal: signer, store: new StoreMemory() })
  const space = await client.createSpace()

  await client.setCurrentSpace(space.did())
  await client.authorize(formValues.email as `${string}@${string}`)
  await client.registerSpace(formValues.email as `${string}@${string}`)

  const proofs = client.proofs()

  // Create tickets
  const tickets = await Promise.all(
    proofs.map(toTicket)
  )

  // Fin
  return { registered: true, tickets }
}

///////////
// UCANS //
///////////

export async function did(
  identifier: Identifier.Implementation,
  inventory: Inventory
): Promise<string> {
  const spaceProof = await findSpaceProofTicket(identifier.did(), inventory)
  if (!spaceProof) throw new Error("Space proof not found")
  return spaceProof.issuer
}

export async function hasSufficientAuthority(
  identifier: Identifier.Implementation,
  inventory: Inventory
): Promise<
  { suffices: true } | { suffices: false; reason: string }
> {
  const spaceProof = await findSpaceProofTicket(identifier.did(), inventory)
  return spaceProof ? { suffices: true } : { suffices: false, reason: "Space proof not found" }
}

export async function provideAuthority(
  accountQuery: AccountQuery,
  identifier: Identifier.Implementation,
  inventory: Inventory
): Promise<Ticket[]> {
  const identifierDID = identifier.did()

  return inventory.lookupTicketsByCategory("account").reduce(
    async (acc, ticket) => {
      const list = await acc
      if (ticket.audience !== identifierDID) return list
      const delegation = await fromTicket(ticket)
      if (delegation.capabilities[0]?.can === "*") return [...list, ticket]
      return list
    },
    Promise.resolve([] as Ticket[])
  )
}

////////
// 🛳 //
////////

export function implementation<FS>(
  dependencies: Dependencies<FS>
): Account.Implementation<Annex> {
  return {
    annex: (identifier: Identifier.Implementation, inventory: Inventory, names: Names) => ({
      volume: () => volume(dependencies, identifier, inventory, names),
    }),

    canRegister,
    register,

    did,
    hasSufficientAuthority,
    provideAuthority,
  }
}

////////
// 🛠️ //
////////

/**
 * Find the root UCAN.
 */
export function findSpaceProofTicket(
  audience: string,
  inventory: Inventory
): Promise<Ticket | null> {
  return inventory.lookupTicketsByAudience(audience).reduce(
    async (acc: Promise<Ticket | null>, ticket) => {
      const result = await acc
      if (result) return result
      const rootTicket = await inventory.rootTicket(ticket, ticketProofResolver)
      if (!rootTicket) return null
      const root = await fromTicket(rootTicket)
      if (root.capabilities[0]?.can === "*") return rootTicket
      return null
    },
    Promise.resolve(null)
  )
}
