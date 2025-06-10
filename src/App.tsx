import { getFullnodeUrl, IotaClient } from "@iota/iota-sdk/client";
import "./App.css";
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { createDocumentForNetworkUsingKeyPair, getCompleteJwkFromKeyPair, getIdentityFromKeyPair, getMemstorage } from "./util";
import { DomainLinkageConfiguration, JwsSignatureOptions, LinkedDomainService, type DIDUrl } from "@iota/identity-wasm/web";

function App() {

  const byteArray = new Uint8Array(64 / 2);
  crypto.getRandomValues(byteArray);
  const seed = Array.from(byteArray)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const keyPair = Ed25519Keypair.deriveKeypairFromSeed(seed)
  const network = "testet"
  const client = new IotaClient({ url: getFullnodeUrl(network) });
  const storage = getMemstorage();




  const handleTest = async () => {
    if (!client || !keyPair || !network) throw new Error("");

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const alg = JwsAlgorithm.EdDSA;
    const jwk = getCompleteJwkFromKeyPair(keyPair, alg);

    await storage.keyStorage().insert(jwk);

    const identityClient = await getIdentityFromKeyPair(
      client,
      storage,
      keyPair,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      JwsAlgorithm.EdDSA
    );

    let localNetwork = network;
    if (localNetwork === "mainnet") localNetwork = "iota";

    const [unpublished, vmFragment1] =
      await createDocumentForNetworkUsingKeyPair(
        storage,
        localNetwork,
        keyPair
      );

    console.log(" - Unpublished DID Document: ", unpublished.toString());
    console.log(" - VM Fragment: ", vmFragment1.toString());

    const { output: identity } = await identityClient
      .createIdentity(unpublished)
      .finish()
      .buildAndExecute(identityClient);

    const controllerToken = await identity.getControllerToken(identityClient);

    console.log("address", keyPair.toIotaAddress());
    console.log("controllerToken:", controllerToken);

    const didDocument = identity.didDocument();
    const did = didDocument.id();

    const serviceUrl: DIDUrl = did.clone().join("#domain_linkage");

    const normalizedDomain ="https://mydomain.com"
    
    const linkedDomainService: LinkedDomainService = new LinkedDomainService({
      id: serviceUrl,
      domains: [normalizedDomain],
    });

    didDocument.insertService(linkedDomainService.toService());

    await identity
      .updateDidDocument(didDocument, controllerToken)
      .buildAndExecute(identityClient);

    

    // Create the Domain Linkage Credential.
    const domainLinkageCredential: Credential =
      Credential.createDomainLinkageCredential({
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

    const configurationResource: DomainLinkageConfiguration =
      new DomainLinkageConfiguration([credentialJwt]);

    const configurationResourceJson = configurationResource.toJSON();
    const jsonStr = JSON.stringify(configurationResourceJson, null, 2);

    downloadVC(jsonStr);

  };


    const downloadVC = (jsonStr: string) => {
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

  return (
    <>
      <h1>Test IOTA Identity 1.6.0-beta.4 + Vite + React</h1>
      <div className="card">
        <button onClick={handleTest}>Click here</button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
    </>
  );
}

export default App;
