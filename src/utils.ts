/* eslint-disable @typescript-eslint/ban-ts-comment */
// Copyright 2020-2025 IOTA Stiftung
// SPDX-License-Identifier: Apache-2.0

import {
  //DIDUrl,
  DomainLinkageConfiguration,
  EdDSAJwsVerifier,
  //Identity,
  IdentityClient,
  IdentityClientReadOnly,
  IotaDID,
  IotaDocument,
  Jwk,
  JwkMemStore,
  JwkType,
  JwsAlgorithm,
  JwtCredentialValidationOptions,
  JwtDomainLinkageValidator,
  KeyIdMemStore,
  MethodData,
  MethodDigest,
  MethodScope,
  MethodType,
  //Service,
  Storage,
  StorageSigner,
  VerificationMethod,
} from "@iota/identity-wasm/web";
import { IotaClient } from "@iota/iota-sdk/client";
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { decodeIotaPrivateKey } from "@iota/iota-sdk/cryptography";
import { Transaction } from "@iota/iota-sdk/transactions";
import { signAndExecTx } from "./signAndExecTx";
import axios from "axios";

export const TEST_GAS_BUDGET = BigInt(50_000_000);

export function getMemstorage(): Storage {
  return new Storage(new JwkMemStore(), new KeyIdMemStore());
}

export function randomSeed(): string {
  const byteArray = new Uint8Array(64 / 2);
  crypto.getRandomValues(byteArray);
  return Array.from(byteArray)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createDocumentForNetwork(storage: Storage, network: string): Promise<[IotaDocument, string]> {
  // Create a new DID document with a placeholder DID.
  const unpublished = new IotaDocument(network);

  const verificationMethodFragment = await unpublished.generateMethod(
    storage,
    JwkMemStore.ed25519KeyType(),
    JwsAlgorithm.EdDSA,
    "#key-1",
    MethodScope.VerificationMethod()
  );

  return [unpublished, verificationMethodFragment];
}

export async function createDocumentForNetworkUsingKeyPair(
  storage: Storage,
  network: string,
  keyPair: Ed25519Keypair
): Promise<[IotaDocument, string]> {
  // Create a new DID document with a placeholder DID.
  const unpublished = new IotaDocument(network);
  const alg = JwsAlgorithm.EdDSA;
  const jwk = getCompleteJwkFromKeyPair(keyPair, alg);

  // Inserisci nel keystore
  const keyId = await storage.keyStorage().insert(jwk);

  const publicJwk = jwk.toPublic();
  if (!publicJwk) {
    throw new Error("Public JWK could not be derived.");
  }

  const methodData = MethodData.newJwk(publicJwk);

  const methodFragment = keyId; // "key-1";
  const methodId = unpublished.id().join(`#${methodFragment}`);

  const method = new VerificationMethod(
    methodId,
    unpublished.id().toCoreDid(),
    MethodType.JsonWebKey2020(),
    methodData
  );

  const methodDig = new MethodDigest(method);

  await storage.keyIdStorage().insertKeyId(methodDig, keyId);

  unpublished.insertMethod(method, MethodScope.VerificationMethod());

  return [unpublished, keyId];
}

export async function resolveDID(didDocObj: string, client: IotaClient, network: string) {
  try {
    let localNetwork = network;
    if (network === "mainnet") localNetwork = "iota";

    const identityClientReadOnly = await IdentityClientReadOnly.create(client);
    const iotaDid = IotaDID.fromAliasId(didDocObj, localNetwork);

    return await identityClientReadOnly.resolveDid(iotaDid);
  } catch (error) {
    console.log(error);
  }
}

export async function getIdentityFromKeyPair(
  client: IotaClient,
  storage: Storage,
  keypair: Ed25519Keypair,
  alg: JwsAlgorithm
): Promise<IdentityClient> {
  const identityClientReadOnly = await IdentityClientReadOnly.create(client);

  const jwk = getCompleteJwkFromKeyPair(keypair, alg);

  const publicKeyJwk = jwk.toPublic();

  if (!publicKeyJwk) {
    throw new Error("Failed to derive public JWK from generated JWK");
  }

  // Insert key into storage
  const keyId = await storage.keyStorage().insert(jwk);

  const storedKeyExists = await storage.keyStorage().exists(keyId);
  if (!storedKeyExists) {
    throw new Error("Key was not properly stored in keyStorage!");
  }

  const signer = new StorageSigner(storage, keyId, publicKeyJwk);

  const identityClient = await IdentityClient.create(identityClientReadOnly, signer);

  return identityClient;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  const base64 = btoa(binary);
  // Convert to base64url
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function getCompleteJwkFromKeyPair(keyPair: Ed25519Keypair, alg: JwsAlgorithm) {
  const publicKeyBytes = keyPair.getPublicKey().toRawBytes();
  const x = base64UrlEncode(publicKeyBytes);

  const privateKeyDecoded = decodeIotaPrivateKey(keyPair.getSecretKey()).secretKey;

  const d = privateKeyDecoded ? base64UrlEncode(privateKeyDecoded) : undefined;

  const jwk = new Jwk({
    kty: JwkType.Okp,
    crv: "Ed25519",
    x,
    d,
    alg,
  });

  return jwk;
}

export function deleteOIDcontrollerCap(
  network: string,
  client: IotaClient,
  keyPair: Ed25519Keypair,
  gasStationCfg: {
    gasStation1URL: string;
    gasStation1Token: string;
    gasStation2URL: string;
    gasStation2Token: string;
  },
  useGasStation: boolean,
  moveFun: string,
  OIDcontrollerCap: string
) {
  const tx = new Transaction();
  const sender = keyPair.toIotaAddress();

  tx.moveCall({
    arguments: [tx.pure.id(sender), tx.object(OIDcontrollerCap)],
    target: moveFun,
  });

  tx.setGasBudget(10000000);
  tx.setSender(sender);

  signAndExecTx(
    network,
    client,
    gasStationCfg,
    useGasStation,
    { keyPair, tx },
    {
      onSuccess: () => {},

      onError: (err: unknown) => {
        console.error("ControllerCap delete failed:", err);
      },
      onSettled: () => {},
    }
  );
}

export async function validate_dlvc(didDocument: IotaDocument, did: string) {
  const methods = didDocument.methods();
  for (const method of methods) {
    const DIDcontroller = method.controller().toUrl().toString();

    if (DIDcontroller === did) {
      const serviceList = didDocument.service();
      for (const service of serviceList) {
        if (service.type().includes("LinkedDomains")) {
          const SE_DID_linked_URL = service.serviceEndpoint();

          let DID_linked_domain = "";

          if (typeof SE_DID_linked_URL === "string") {
            const url = new URL(SE_DID_linked_URL);
            DID_linked_domain = url.hostname;
          } else if (Array.isArray(SE_DID_linked_URL)) {
            // Prendi il primo elemento dell'array, se esiste
            const url = new URL(SE_DID_linked_URL[0]);
            DID_linked_domain = url.hostname;
          } else if (SE_DID_linked_URL instanceof Map) {
            // Recupera il primo valore della mappa
            const first = SE_DID_linked_URL.values().next().value;
            if (Array.isArray(first) && first.length > 0) {
              const url = new URL(first[0]);
              DID_linked_domain = url.hostname;
            }
          }

          DID_linked_domain = "https://" + DID_linked_domain.replace(/^www\./, "") + "/";
          const DID_linked_URL = service.serviceEndpoint().toString();

          const configUrl = `${DID_linked_domain}.well-known/did-configuration.json?ts=${Date.now()}`;
          const response = await axios.get(configUrl);

          if (response?.data?.linked_dids || Array.isArray(response.data.linked_dids)) {
            const [jwt] = response.data.linked_dids;

            if (!(typeof jwt !== "string" || jwt.split(".").length !== 3)) {
              const fetchedConfigurationResource = DomainLinkageConfiguration.fromJSON(response.data);

              try {
                new JwtDomainLinkageValidator(new EdDSAJwsVerifier()).validateLinkage(
                  didDocument,
                  fetchedConfigurationResource,
                  DID_linked_URL,
                  new JwtCredentialValidationOptions()
                );

                return true;
              } catch (error: unknown) {
                console.log(error);
                return false;
              }
            }
          } else {
            return false;
          }
        }
      }
    }
  }
}

export const downloadVC = (jsonStr: string) => {
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "did-configuration.json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
