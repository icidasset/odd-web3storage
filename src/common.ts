import * as Ucanto from "@ucanto/core"
import * as Uint8Arrays from "uint8arrays"

import { create as createSignature, nameCode } from "@ipld/dag-ucan/signature"
import { DID } from "@ucanto/interface"
import { SignerArchive } from "@ucanto/interface"
import { InvocationConfig } from "@web3-storage/upload-client/types"
import { Agent, Identifier, CID, Inventory, Ticket } from "@oddjs/odd"

////////
// 🏔️ //
////////

export const HOST = "https://up.web3.storage"
export const PRINCIPAL = Ucanto.DID.parse("did:web:web3.storage")

////////
// 🛠️ //
////////

export function agentSigner(agent: Agent.Implementation): Signer {
  return new Signer(agent.did(), agent.sign, agent.ucanAlgorithm())
}

export async function config(
  inventory: Inventory,
  signer: Signer
): Promise<{ config: InvocationConfig; error: undefined } | { config: undefined; error: string }> {
  const accountProofs = await Promise.all(inventory.lookupTicketsByCategory("account").map(fromTicket))
  const agentProofs = await Promise.all(inventory.lookupTicketsByCategory("agent").map(fromTicket))

  const spaceProof = accountProofs.find(p => p.capabilities.some(c => c.can === "*"))
  const spaceDID = spaceProof ? spaceProof.capabilities[0]?.with : null

  if (!spaceDID) return { config: undefined, error: "Cannot determine space DID" }
  if (!agentProofs.length) return { config: undefined, error: "Missing agent delegation" }

  return {
    config: {
      issuer: signer,
      with: spaceDID as DID<"key">,
      proofs: agentProofs,
    },
    error: undefined,
  }
}

export function identifierSigner(identifier: Identifier.Implementation): Signer {
  return new Signer(identifier.did(), identifier.sign, identifier.ucanAlgorithm())
}

export async function ticketProofResolver(ticket: Ticket): Promise<CID[]> {
  const delegation = await fromTicket(ticket)
  return delegation.proofs.map(p => CID.decode(p.link().bytes))
}

export async function fromTicket(ticket: Ticket): Promise<Ucanto.API.Delegation> {
  const result = await Ucanto.Delegation.extract(
    Uint8Arrays.fromString(ticket.token, "base64url")
  )

  if (result.error) throw new Error(result.error.message)
  return result.ok
}

export async function toTicket(delegation: Ucanto.API.Delegation): Promise<Ticket> {
  const result = await delegation.archive()
  if (result.error) throw new Error(result.error.message)

  return {
    issuer: delegation.issuer.did(),
    audience: delegation.audience.did(),
    token: Uint8Arrays.toString(result.ok, "base64url"),
  }
}

////////////
// SIGNER //
////////////

export class Signer<
  ID extends DID = DID<"key">,
> implements Ucanto.API.Signer {
  #did: ID
  #signer: (data: Uint8Array) => Promise<Uint8Array>
  #ucanAlgorithm: string

  constructor(
    did: string,
    signer: (data: Uint8Array) => Promise<Uint8Array>,
    ucanAlgorithm: string
  ) {
    this.#did = did as ID
    this.#signer = signer
    this.#ucanAlgorithm = ucanAlgorithm
  }

  get signer() {
    return this
  }

  get signatureCode() {
    return nameCode(this.signatureAlgorithm)
  }

  get signatureAlgorithm() {
    return this.#ucanAlgorithm
  }

  did(): ID {
    return this.#did
  }

  toDIDKey(): DID<"key"> {
    return this.#did as DID<"key">
  }

  get verifier() {
    return this
  }

  async sign(data: Uint8Array) {
    return createSignature(this.signatureCode, await this.#signer(data))
  }

  async verify(bytes: Uint8Array, signature: Uint8Array): Promise<boolean> {
    // TODO
    console.log("verify", bytes, signature)
    return true
  }

  toArchive(): SignerArchive<ID> {
    return {
      id: this.did(),
      keys: {},
    }
  }

  withDID<ID extends DID>(id: ID): Signer<ID> {
    return new Signer(id, this.#signer, this.#ucanAlgorithm)
  }
}
