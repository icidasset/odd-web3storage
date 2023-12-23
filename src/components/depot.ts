import * as DagCBOR from "@ipld/dag-cbor";

import { LevelBlockstore } from "blockstore-level";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { CAR, Store } from "@web3-storage/upload-client";
import { Block } from "multiformats";
import { Agent, Depot, Inventory, Ticket, Storage, decodeCID } from "@oddjs/odd";

import { agentSigner, config } from "../common.js";
import { Blockstore } from "interface-blockstore";

////////
// 🛳 //
////////

export type ImplementationOptions = {
  agent: Agent.Implementation;
  blockstoreName: string;
  storage: Storage.Implementation;
};

export async function implementation({
  agent,
  blockstoreName,
  storage,
}: ImplementationOptions): Promise<Depot.Implementation> {
  const levelBlockstore = new LevelBlockstore(blockstoreName, { prefix: "" });

  // Depot tracker
  const dt = await storage.getItem("depot-tracker");

  const DEPOT_TRACKER: Record<string, Block> = dt
    ? await JSON.parse(dt as string).reduce(
        async (acc: Promise<Record<string, Block>>, cid: string) => {
          const decodedCID = decodeCID(cid);
          const bytes = await blockstore.get(decodedCID);
          const block: Block = { bytes, cid: decodedCID.toV1() };

          return {
            ...acc,
            [cid]: block,
          };
        },
        {},
      )
    : {};

  // Blockstore
  const blockstore: Blockstore = {
    delete: levelBlockstore.delete,
    deleteMany: levelBlockstore.deleteMany,
    getAll: levelBlockstore.getAll,
    getMany: levelBlockstore.getMany,
    has: levelBlockstore.has,
    putMany: levelBlockstore.putMany,

    async get(key: CID): Promise<Uint8Array> {
      if (await levelBlockstore.has(key)) return levelBlockstore.get(key);

      // TODO: Can we use CAR files to get a bunch of blocks at once?
      return fetch(`https://${key.toString()}.ipfs.w3s.link/?format=raw`)
        .then((r) => {
          if (r.ok) return r.arrayBuffer();
          throw new Error("Failed to fetch block from gateway");
        })
        .then((r) => new Uint8Array(r))
        .then(async (r) => {
          await blockstore.put(key, r);
          return r;
        });
    },

    async put(key: CID, value: Uint8Array): Promise<CID> {
      await levelBlockstore.put(key, value);

      // Depot tracker
      const block: Block = { bytes: value, cid: key.toV1() };
      DEPOT_TRACKER[key.toString()] = block;

      await storage.setItem("depot-tracker", JSON.stringify(Object.keys(DEPOT_TRACKER)));

      // Fin
      return key;
    },
  };

  // Implementation
  // --------------
  return {
    blockstore,

    // FLUSH

    flush: async (_dataRoot: CID, _proofs: Ticket[], inventory: Inventory): Promise<void> => {
      const result = await config(inventory, agentSigner(agent));
      if (!result.config) return;
      const cfg = result.config;

      const blocks = Object.keys(DEPOT_TRACKER).map((k) => {
        const block = DEPOT_TRACKER[k];
        delete DEPOT_TRACKER[k];
        return block;
      });

      await storage.setItem("depot-tracker", JSON.stringify(Object.keys(DEPOT_TRACKER)));

      // Build DAG to reference all blocks
      const dag = DagCBOR.encode(blocks.map((b) => b.cid));
      const codec = DagCBOR.code;
      const multihash = await sha256.digest(dag);
      const cid = CID.createV1(codec, multihash);

      // Add to store and upload CAR
      await Store.add(cfg, await CAR.encode(blocks, cid));
    },
  };
}
