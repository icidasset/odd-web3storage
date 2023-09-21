import * as DagCBOR from "@ipld/dag-cbor"
import * as Codecs from "@oddjs/odd/dag/codecs"

import { LevelBlockstore } from "blockstore-level"
import { CID } from "multiformats/cid"
import { sha256 } from "multiformats/hashes/sha2"
import { CAR, Store } from "@web3-storage/upload-client"
import { Block } from "multiformats"
import { Agent, Depot, Inventory, CodecIdentifier, Ticket } from "@oddjs/odd"

import { agentSigner, config } from "../common.js"

////////
// 🛳 //
////////

export type ImplementationOptions = {
  agent: Agent.Implementation
  blockstoreName: string
}

export async function implementation(
  { agent, blockstoreName }: ImplementationOptions
): Promise<Depot.Implementation> {
  const blockstore = new LevelBlockstore(blockstoreName, { prefix: "" })

  const DEPOT_TRACKER: Block[] = []

  // Implementation
  // --------------
  return {
    blockstore,

    // GET

    getBlock: async (cid: CID): Promise<Uint8Array> => {
      if (await blockstore.has(cid)) return blockstore.get(cid)

      // TODO: Can we use CAR files to get a bunch of blocks at once?
      return fetch(`https://w3s.link/ipfs/${cid.toString()}?format=raw`)
        .then(r => {
          if (r.ok) return r.arrayBuffer()
          throw new Error("Failed to fetch block from gateway")
        })
        .then(r => new Uint8Array(r))
        .then(async r => {
          await blockstore.put(cid, r)
          return r
        })
    },

    // PUT

    putBlock: async (data: Uint8Array, codecId: CodecIdentifier): Promise<CID> => {
      const codec = Codecs.getByIdentifier(codecId)
      const multihash = await sha256.digest(data)
      const cid = CID.createV1(codec.code, multihash)
      const block: Block = { bytes: data, cid }

      await blockstore.put(cid, data)

      DEPOT_TRACKER.push(block)

      return cid
    },

    // FLUSH

    flush: async (_dataRoot: CID, _proofs: Ticket[], inventory: Inventory): Promise<void> => {
      const result = await config(inventory, agentSigner(agent))
      if (!result.config) return
      const cfg = result.config

      const blocks = DEPOT_TRACKER.slice(0)

      DEPOT_TRACKER.length = 0

      // Build DAG to reference all blocks
      const dag = DagCBOR.encode(blocks.map(b => b.cid))
      const codec = DagCBOR.code
      const multihash = await sha256.digest(dag)
      const cid = CID.createV1(codec, multihash)

      // Add to store and upload CAR
      await Store.add(
        cfg,
        await CAR.encode(blocks, cid)
      )
    },
  }
}
