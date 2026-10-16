/**
 * Transaction signing delegation and cosigner collection (#586).
 *
 * Provides SDK support for coordinated multi-signer collection where multiple
 * signers contribute signatures to a transaction envelope incrementally.
 */

import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { StrKey } from "@stellar/stellar-sdk";

/**
 * A signing request holding an XDR and tracking collected signatures.
 */
export interface SigningRequest {
  xdr: string;
  requiredSigners: string[];
  /**
   * Signatures collected so far, keyed by signer public key.
   *
   * A plain record (not a `Map`) so that signing requests survive
   * `JSON.stringify`/`JSON.parse` round-trips without silently dropping
   * signatures when persisted, transmitted, or logged.
   */
  collectedSignatures: Record<string, string>;
  threshold: number;
}

/**
 * Signing status showing progress toward completion.
 */
export interface SigningStatus {
  pending: string[];
  signed: string[];
  complete: boolean;
  progress: number;
  thresholdMet: boolean;
}

/**
 * Create a signing request with required signers and threshold.
 *
 * @param xdr - Transaction XDR (base64)
 * @param requiredSigners - Array of public keys required to sign (G... addresses)
 * @param threshold - Minimum cumulative weight to consider complete (defaults to all signers)
 * @returns A SorokitResult containing the signing request
 *
 * @example
 * const request = await client.transaction.createSigningRequest(xdr, [signer1, signer2]);
 */
export function createSigningRequest(
  xdr: string,
  requiredSigners: string[],
  threshold?: number,
): SorokitResult<SigningRequest> {
  if (!xdr || typeof xdr !== "string") {
    return err(
      SorokitErrorCode.INVALID_TRANSACTION,
      "Transaction XDR must be a non-empty string",
    );
  }

  if (!Array.isArray(requiredSigners) || requiredSigners.length === 0) {
    return err(
      SorokitErrorCode.INVALID_TRANSACTION,
      "Required signers must be a non-empty array",
    );
  }

  for (const signer of requiredSigners) {
    if (!StrKey.isValidEd25519PublicKey(signer)) {
      return err(
        SorokitErrorCode.INVALID_ADDRESS,
        `Invalid signer address: ${signer}. Expected G... address.`,
      );
    }
  }

  const finalThreshold = threshold ?? requiredSigners.length;
  if (finalThreshold < 1 || finalThreshold > requiredSigners.length) {
    return err(
      SorokitErrorCode.VALIDATION,
      `Threshold must be between 1 and ${requiredSigners.length}`,
    );
  }

  const request: SigningRequest = {
    xdr,
    requiredSigners,
    collectedSignatures: {},
    threshold: finalThreshold,
  };

  return ok(request);
}

/**
 * Serialize a signing request to a JSON string. Because `collectedSignatures`
 * is a plain record, signatures round-trip losslessly.
 */
export function serializeSigningRequest(request: SigningRequest): string {
  return JSON.stringify(request);
}

/**
 * Rehydrate a signing request produced by `serializeSigningRequest` (or a
 * plain `JSON.stringify` of a request).
 */
export function deserializeSigningRequest(
  serialized: string,
): SorokitResult<SigningRequest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return err(
      SorokitErrorCode.VALIDATION,
      "Signing request must be valid JSON",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return err(
      SorokitErrorCode.VALIDATION,
      "Signing request must be a JSON object",
    );
  }

  const candidate = parsed as Partial<SigningRequest>;
  if (
    typeof candidate.xdr !== "string" ||
    !Array.isArray(candidate.requiredSigners) ||
    typeof candidate.threshold !== "number"
  ) {
    return err(
      SorokitErrorCode.VALIDATION,
      "Signing request is missing required fields",
    );
  }

  const rawSignatures = candidate.collectedSignatures;
  const collectedSignatures: Record<string, string> = {};
  if (rawSignatures && typeof rawSignatures === "object" && !Array.isArray(rawSignatures)) {
    for (const [signer, signature] of Object.entries(rawSignatures)) {
      if (typeof signature === "string") collectedSignatures[signer] = signature;
    }
  }

  return ok({
    xdr: candidate.xdr,
    requiredSigners: candidate.requiredSigners as string[],
    collectedSignatures,
    threshold: candidate.threshold,
  });
}

/**
 * Add a signature to a signing request with validation.
 *
 * @param request - The signing request to update
 * @param signature - The signature hex string
 * @param signer - Public key of the signer (G... address)
 * @returns A SorokitResult indicating success or error
 *
 * @example
 * const result = await client.transaction.addSignature(request, sig1, signer1);
 */
export function addSignature(
  request: SigningRequest,
  signature: string,
  signer: string,
): SorokitResult<void> {
  if (!request || typeof request !== "object") {
    return err(
      SorokitErrorCode.VALIDATION,
      "Signing request must be a valid object",
    );
  }

  if (!signature || typeof signature !== "string") {
    return err(
      SorokitErrorCode.VALIDATION,
      "Signature must be a non-empty string",
    );
  }

  if (!StrKey.isValidEd25519PublicKey(signer)) {
    return err(
      SorokitErrorCode.INVALID_ADDRESS,
      `Invalid signer address: ${signer}. Expected G... address.`,
    );
  }

  if (!request.requiredSigners.includes(signer)) {
    return err(
      SorokitErrorCode.VALIDATION,
      `Signer ${signer} is not in the list of required signers`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(request.collectedSignatures, signer)) {
    return err(
      SorokitErrorCode.VALIDATION,
      `Signature from ${signer} already collected (duplicate submission)`,
    );
  }

  request.collectedSignatures[signer] = signature;
  return ok(undefined);
}

/**
 * Check if a signing request has met its threshold.
 *
 * @param request - The signing request to check
 * @returns A SorokitResult containing the threshold status
 *
 * @example
 * const result = await client.transaction.isComplete(request);
 * if (result.status === "ok") console.log(result.data);
 */
export function isComplete(request: SigningRequest): SorokitResult<boolean> {
  if (!request || typeof request !== "object") {
    return err(
      SorokitErrorCode.VALIDATION,
      "Signing request must be a valid object",
    );
  }

  const signatureCount = Object.keys(request.collectedSignatures).length;
  const complete = signatureCount >= request.threshold;

  return ok(complete);
}

/**
 * Get the current signing status of a request.
 *
 * @param request - The signing request to query
 * @returns A SorokitResult containing detailed signing status
 *
 * @example
 * const status = await client.transaction.getSigningStatus(request);
 * // { pending: [signer2], signed: [signer1], complete: false, progress: 0.5, thresholdMet: false }
 */
export function getSigningStatus(
  request: SigningRequest,
): SorokitResult<SigningStatus> {
  if (!request || typeof request !== "object") {
    return err(
      SorokitErrorCode.VALIDATION,
      "Signing request must be a valid object",
    );
  }

  const signed = Object.keys(request.collectedSignatures);
  const pending = request.requiredSigners.filter(
    (signer) => !signed.includes(signer),
  );
  const thresholdMet = signed.length >= request.threshold;
  const progress = request.requiredSigners.length > 0
    ? signed.length / request.requiredSigners.length
    : 0;

  const status: SigningStatus = {
    pending,
    signed,
    complete: thresholdMet,
    progress,
    thresholdMet,
  };

  return ok(status);
}
