import {
  Account,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { buildMultiSigEnvelope } from "../transaction/multiSig";
import { SorokitErrorCode } from "../shared/response";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const KEY_A = Keypair.random();
const KEY_B = Keypair.random();

function buildUnsignedXdr(): string {
  const source = new Account(KEY_A.publicKey(), "1");
  return new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
    .setTimeout(0)
    .build()
    .toXDR();
}

describe("buildMultiSigEnvelope", () => {
  const unsignedXdr = buildUnsignedXdr();

  it("accepts a valid threshold equal to total weight", () => {
    const result = buildMultiSigEnvelope(unsignedXdr, NETWORK_PASSPHRASE, {
      signers: [
        { publicKey: KEY_A.publicKey(), weight: 1 },
        { publicKey: KEY_B.publicKey(), weight: 1 },
      ],
      threshold: 2,
    });

    expect(result.status).toBe("ok");
    expect(result.data?.threshold).toBe(2);
    expect(result.data?.collectedWeight).toBe(0);
    expect(result.data?.thresholdMet).toBe(false);
  });

  it("accepts a valid threshold less than total weight", () => {
    const result = buildMultiSigEnvelope(unsignedXdr, NETWORK_PASSPHRASE, {
      signers: [
        { publicKey: KEY_A.publicKey(), weight: 2 },
        { publicKey: KEY_B.publicKey(), weight: 2 },
      ],
      threshold: 2,
    });

    expect(result.status).toBe("ok");
    expect(result.data?.threshold).toBe(2);
  });

  it("rejects threshold greater than total weight", () => {
    const result = buildMultiSigEnvelope(unsignedXdr, NETWORK_PASSPHRASE, {
      signers: [
        { publicKey: KEY_A.publicKey(), weight: 1 },
        { publicKey: KEY_B.publicKey(), weight: 1 },
      ],
      threshold: 10,
    });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
    expect(result.error?.message).toContain("threshold (10)");
    expect(result.error?.message).toContain("exceeds");
    expect(result.error?.message).toContain("(2)");
  });

  it("includes both threshold and total weight in error message", () => {
    const result = buildMultiSigEnvelope(unsignedXdr, NETWORK_PASSPHRASE, {
      signers: [{ publicKey: KEY_A.publicKey(), weight: 5 }],
      threshold: 100,
    });

    expect(result.status).toBe("error");
    expect(result.error?.message).toContain("100");
    expect(result.error?.message).toContain("5");
  });

  it("rejects threshold below 1", () => {
    const result = buildMultiSigEnvelope(unsignedXdr, NETWORK_PASSPHRASE, {
      signers: [{ publicKey: KEY_A.publicKey(), weight: 1 }],
      threshold: 0,
    });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
  });

  it("rejects empty signer list", () => {
    const result = buildMultiSigEnvelope(unsignedXdr, NETWORK_PASSPHRASE, {
      signers: [],
      threshold: 1,
    });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
    expect(result.error?.message).toContain("at least one signer");
  });

  it("rejects signer with weight < 1", () => {
    const result = buildMultiSigEnvelope(unsignedXdr, NETWORK_PASSPHRASE, {
      signers: [{ publicKey: KEY_A.publicKey(), weight: 0 }],
      threshold: 1,
    });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
    expect(result.error?.message).toContain("invalid weight");
  });

  it("rejects malformed XDR", () => {
    const result = buildMultiSigEnvelope("not-valid-xdr", NETWORK_PASSPHRASE, {
      signers: [{ publicKey: KEY_A.publicKey(), weight: 1 }],
      threshold: 1,
    });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
  });

  it("accepts threshold of 1 with single signer", () => {
    const result = buildMultiSigEnvelope(unsignedXdr, NETWORK_PASSPHRASE, {
      signers: [{ publicKey: KEY_A.publicKey(), weight: 1 }],
      threshold: 1,
    });

    expect(result.status).toBe("ok");
  });

  it("accepts high weight signers with reasonable threshold", () => {
    const result = buildMultiSigEnvelope(unsignedXdr, NETWORK_PASSPHRASE, {
      signers: [
        { publicKey: KEY_A.publicKey(), weight: 100 },
        { publicKey: KEY_B.publicKey(), weight: 50 },
      ],
      threshold: 150,
    });

    expect(result.status).toBe("ok");
    expect(result.data?.threshold).toBe(150);
  });
});
