import {
  rpc as SorobanRpc,
  Operation,
  TransactionBuilder,
  Horizon,
  BASE_FEE,
  xdr,
  Address,
} from "@stellar/stellar-sdk";
import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { isNetworkConnectivityError, isNotFoundError, toMessage } from "../shared";
import { DEFAULT_TX_TIMEOUT_SECONDS } from "../shared/constants";
import type { StorageEntry, StorageRentResult, RenewContractStorageResult } from "./types";

export interface CalculateStorageRentOptions {
  rpcUrl: string;
  networkPassphrase: string;
}

export interface RenewContractStorageOptions {
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  publicKey: string;
}

/**
 * Fetch real TTL data for one or more contract persistent-instance storage entries
 * via a single batched getLedgerEntries RPC call.
 *
 * Returns a StorageRentResult containing the live ledger sequence and per-entry TTL info.
 */
export async function calculateStorageRent(
  contractIds: string[],
  options: CalculateStorageRentOptions,
): Promise<SorokitResult<StorageRentResult>> {
  if (!Array.isArray(contractIds) || contractIds.length === 0) {
    return err(
      SorokitErrorCode.TX_BUILD_FAILED,
      "calculateStorageRent requires at least one contractId.",
    );
  }

  let keys: xdr.LedgerKey[];
  try {
    keys = contractIds.map((contractId) => {
      const address = Address.fromString(contractId);
      return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: address.toScAddress(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      );
    });
  } catch (cause) {
    return err(
      SorokitErrorCode.TX_BUILD_FAILED,
      `Failed to build ledger keys for contract IDs: ${toMessage(cause)}`,
      cause,
    );
  }

  try {
    const rpc = new SorobanRpc.Server(options.rpcUrl);
    const response = await rpc.getLedgerEntries(...keys);
    const latestLedger: number = response.latestLedger;

    // Build a map from key XDR to liveUntilLedgerSeq for fast lookup
    const ttlByKeyXdr = new Map<string, number>();
    for (const entry of response.entries) {
      if (entry.liveUntilLedgerSeq !== undefined) {
        const keyBase64 = entry.key.toXDR("base64");
        ttlByKeyXdr.set(keyBase64, entry.liveUntilLedgerSeq);
      }
    }

    const entries: StorageEntry[] = keys.map((key, index) => {
      const keyXdr = key.toXDR("base64");
      const liveUntilLedgerSeq = ttlByKeyXdr.get(keyXdr) ?? 0;
      const remainingLedgers = Math.max(0, liveUntilLedgerSeq - latestLedger);
      const estimatedRenewalCostStroops =
        remainingLedgers <= 0 ? 0 : Math.ceil(remainingLedgers / 1000) * 10000;

      return {
        // contractIds.length === keys.length, so index is always in-bounds
        contractId: contractIds[index] as string,
        keyXdr,
        liveUntilLedgerSeq,
        remainingLedgers,
        estimatedRenewalCostStroops,
      };
    });

    return ok({ ledgerSequence: latestLedger, entries });
  } catch (cause) {
    if (isNetworkConnectivityError(cause)) {
      return err(
        SorokitErrorCode.NETWORK_ERROR,
        `Failed to fetch ledger entries due to network connectivity: ${toMessage(cause)}`,
        cause,
      );
    }
    return err(
      SorokitErrorCode.NETWORK_ERROR,
      `Failed to fetch ledger entries: ${toMessage(cause)}`,
      cause,
    );
  }
}

/**
 * Build a valid ExtendFootprintTTL transaction XDR for the given contract.
 *
 * Returns a Base64-encoded TransactionEnvelope that can be decoded by
 * TransactionBuilder.fromXDR(xdr, networkPassphrase) without error.
 * The caller must sign and submit the transaction separately.
 */
export async function renewContractStorage(
  contractId: string,
  extendToLedger: number,
  options: RenewContractStorageOptions,
): Promise<SorokitResult<RenewContractStorageResult>> {
  let sourceAccount: { sequence: string; accountId: () => string };

  try {
    const horizonServer = new Horizon.Server(options.horizonUrl);
    sourceAccount = await horizonServer.loadAccount(options.publicKey);
  } catch (cause) {
    if (isNotFoundError(cause)) {
      return err(
        SorokitErrorCode.ACCOUNT_NOT_FOUND,
        `Account not found on the network: ${options.publicKey}`,
        cause,
      );
    }
    return err(
      SorokitErrorCode.ACCOUNT_FETCH_FAILED,
      `Failed to load account ${options.publicKey}: ${toMessage(cause)}`,
      cause,
    );
  }

  try {
    // Capture sequence before TransactionBuilder.build() increments it
    const suggestedSequence = String(sourceAccount.sequence);

    const tx = new TransactionBuilder(sourceAccount as any, {
      fee: BASE_FEE,
      networkPassphrase: options.networkPassphrase,
    })
      .addOperation(Operation.extendFootprintTtl({ extendTo: extendToLedger }))
      .setTimeout(DEFAULT_TX_TIMEOUT_SECONDS)
      .build();

    const operationXdr = tx.toEnvelope().toXDR().toString("base64");

    return ok({
      operationXdr,
      suggestedSequence,
    });
  } catch (cause) {
    return err(
      SorokitErrorCode.TX_BUILD_FAILED,
      `Failed to build ExtendFootprintTTL transaction: ${toMessage(cause)}`,
      cause,
    );
  }
}
