import * as UCAN from "@ipld/dag-ucan"
import * as Ucanto from "@ucanto/core"

import { DID } from "@ipld/dag-ucan"
import { Signer as Ed25519Signer } from "@ucanto/principal/ed25519"

import * as AgentDID from "@oddjs/odd/agent/did"
import { Agent, Clerk, Identifier, CID, Ticket } from "@oddjs/odd"
import { path as Path } from "@oddjs/odd"

import { fromTicket, identifierSigner, ticketProofResolver, toTicket } from "../common.js"

///////////
// CLERK //
///////////

export async function cid(ticket: Ticket): Promise<CID> {
  const l = await link(ticket)
  return CID.decode(l.bytes)
}

export async function createOriginFileSystemTicket(
  path: Path.DistinctivePath<Path.Segments>,
  audience: string
): Promise<Ticket> {
  const principal = await Ed25519Signer.generate()
  const delegation = await Ucanto.delegate({
    issuer: principal,
    audience: { did: () => audience as DID<"key"> },

    capabilities: [
      {
        with: `wnfs://${principal.did()}${Path.toPosix(path, { absolute: true })}`,
        can: "fs/*",
      },
    ],
  })

  return toTicket(delegation)
}

export async function delegate(
  ticket: Ticket,
  identifier: Identifier.Implementation,
  remoteIdentifierDID: string
): Promise<Ticket> {
  const signer = identifierSigner(identifier)
  const proof = await fromTicket(ticket)

  const delegation = await Ucanto.delegate({
    issuer: signer,
    audience: { did: () => remoteIdentifierDID as DID<"key"> },
    proofs: [proof],
    expiration: Infinity,
    capabilities: proof.capabilities,
  })

  return toTicket(delegation)
}

export async function link(ticket: Ticket): Promise<UCAN.Link> {
  const delegation = await fromTicket(ticket)
  return delegation.cid
}

export async function identifierToAgentDelegation(
  identifier: Identifier.Implementation,
  agent: Agent.Implementation,
  proofs: Ticket[]
): Promise<Ticket> {
  const signer = identifierSigner(identifier)
  const agentDID = await AgentDID.signing(agent) as DID<"key">

  const spaceTicket = proofs.filter(p => p.audience === identifier.did())[0]
  if (!spaceTicket) throw new Error("Couldn't find space proof")

  const space = (await fromTicket(spaceTicket)).capabilities[0]?.with

  // Delegate space to agent
  const delegation = await Ucanto.delegate({
    issuer: signer,
    audience: { did: () => agentDID },
    proofs: await Promise.all(
      proofs.map(p => fromTicket(p))
    ),

    capabilities: [{
      can: "*",
      with: space,
    }],

    expiration: Infinity,
  })

  return toTicket(delegation)
}

export function matchFileSystemTicket(
  path: Path.DistinctivePath<Path.Segments>,
  did: string
): (ticket: Ticket) => Promise<boolean> {
  return async (ticket: Ticket): Promise<boolean> => {
    const capWith = `wnfs://${did}/${Path.toPosix(path)}`
    const delegation = await fromTicket(ticket)

    return !!delegation.capabilities.find(cap => {
      return cap.with === capWith && cap.can === "fs/*"
    })
  }
}

////////
// 🛳️ //
////////

export function implementation(): Clerk.Implementation {
  return {
    tickets: {
      cid,
      delegate,
      proofResolver: ticketProofResolver,
      fileSystem: {
        origin: createOriginFileSystemTicket,
        matcher: matchFileSystemTicket,
      },
      misc: {
        identifierToAgentDelegation,
      },
    },
  }
}
