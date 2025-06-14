import { getFullnodeUrl, IotaClient, type IotaObjectRef } from "@iota/iota-sdk/client";
import "./App.css";
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import {
  createDocumentForNetworkUsingKeyPair,
  downloadVC,
  getCompleteJwkFromKeyPair,
  getIdentityFromKeyPair,
  randomSeed,
  //getMemstorage,
} from "./utils";
import {
  //DomainLinkageConfiguration,
  //Duration,
  //JwsSignatureOptions,
  LinkedDomainService,
  //Timestamp,
  type DIDUrl,
  Storage,
  JwkMemStore,
  JwsAlgorithm,
  KeyIdMemStore,
  init,
  Timestamp,
  Duration,
  Credential,
  JwsSignatureOptions,
  DomainLinkageConfiguration,
} from "@iota/identity-wasm/web";
import wasmUrl from "@iota/identity-wasm/web/identity_wasm_bg.wasm?url";

import { reserveGas, sponsorSignAndSubmit } from "./signAndExecTx";

function App() {
  const network = "testnet";
  const seed = randomSeed();
  const keyPair = Ed25519Keypair.deriveKeypairFromSeed(seed);
  const client = new IotaClient({ url: getFullnodeUrl(network) });

  const gasStation = {
    gasStation1URL: "https://gas1.objectid.io",
    gasStation1Token: "1111",
    gasStation2URL: "https://gas2.objectid.io",
    gasStation2Token: "1111",
  };

  const handleTest = async () => {
    await init(wasmUrl);
    console.log("init done");

    if (!client || !keyPair || !network) throw new Error("");

    const gasBudget = 50_000_000;
    const gasBudgetBI = BigInt(50000000);

    const reservedSponsorGasData = await reserveGas(gasBudget, gasStation);

    console.log("Using gasStation ", reservedSponsorGasData.gasStationUsed);

    wait(1);

    const payment = reservedSponsorGasData.gas_coins as IotaObjectRef[];
    const gasPrice = await client.getReferenceGasPrice();

    const alg = JwsAlgorithm.EdDSA;
    const jwk = getCompleteJwkFromKeyPair(keyPair, alg);

    const storage = new Storage(new JwkMemStore(), new KeyIdMemStore());

    await storage.keyStorage().insert(jwk);

    const identityClient = await getIdentityFromKeyPair(client, storage, keyPair, JwsAlgorithm.EdDSA);
    let localNetwork = network;
    if (localNetwork === "mainnet") localNetwork = "iota";

    const [unpublished, vmFragment1] = await createDocumentForNetworkUsingKeyPair(storage, localNetwork, keyPair);

    //console.log(" - Unpublished DID Document: ", unpublished.toString());
    //console.log(" - VM Fragment: ", vmFragment1.toString());
    wait(1);

    const [tx_data_bcs, [senderSig], createIdentity] = await identityClient
      .createIdentity(unpublished)
      .finish()
      .withGasBudget(gasBudgetBI)
      .withGasOwner(reservedSponsorGasData.sponsor_address)
      .withGasPayment(payment)
      .withGasPrice(gasPrice)
      .build(identityClient);

    const transactionEffects = await sponsorSignAndSubmit(
      reservedSponsorGasData.reservation_id,
      tx_data_bcs,
      senderSig,
      reservedSponsorGasData.gasStationUsed
    );

    wait(1);

    const identity = await createIdentity.apply(transactionEffects, identityClient);
    const controllerToken = await identity.getControllerToken(identityClient);

    if (controllerToken) {
      const didDocument = identity.didDocument();
      const did = didDocument.id();

      const serviceUrl: DIDUrl = did.clone().join("#domain_linkage");

      const normalizedDomain = "https://mydomain.com";

      const linkedDomainService: LinkedDomainService = new LinkedDomainService({
        id: serviceUrl,
        domains: [normalizedDomain],
      });

      didDocument.insertService(linkedDomainService.toService());

      const reservedSponsorGasData = await reserveGas(gasBudget, gasStation);
      console.log("Using gasStation ", reservedSponsorGasData.gasStationUsed);

      const payment = reservedSponsorGasData.gas_coins as IotaObjectRef[];

      const [tx_data_bcs, [senderSig]] = await identity
        .updateDidDocument(didDocument, controllerToken)
        .withGasBudget(gasBudgetBI)
        .withGasOwner(reservedSponsorGasData.sponsor_address)
        .withGasPayment(payment)
        .withGasPrice(gasPrice)
        .build(identityClient);

      const transactionEffects = await sponsorSignAndSubmit(
        reservedSponsorGasData.reservation_id,
        tx_data_bcs,
        senderSig,
        reservedSponsorGasData.gasStationUsed
      );

      console.log("tx effect:", transactionEffects.transactionDigest);

      // Create the Domain Linkage Credential.
      const domainLinkageCredential: Credential = Credential.createDomainLinkageCredential({
        issuer: didDocument.id(),
        origin: normalizedDomain,
        expirationDate: Timestamp.nowUTC().checkedAdd(Duration.weeks(52))!,
      });

      // Sign the credential.
      const credentialJwt = await didDocument.createCredentialJwt(
        storage,
        vmFragment1,
        domainLinkageCredential,
        new JwsSignatureOptions()
      );

      const configurationResource: DomainLinkageConfiguration = new DomainLinkageConfiguration([credentialJwt]);

      const configurationResourceJson = configurationResource.toJSON();
      const jsonStr = JSON.stringify(configurationResourceJson, null, 2);

      downloadVC(jsonStr);
    }
  };

  return (
    <>
      <h1>Test IOTA Identity 1.6.0-beta.4 + Vite + React</h1>
      <div className="card">
        <button onClick={handleTest}>Click here</button>
        <p>if successful, DLVC for mydomain.com will be downloaded</p>
      </div>
    </>
  );
}

export default App;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wait(s: number) {
  console.log("wait...");
  await delay(s * 1000);
  console.log("done!");
}
