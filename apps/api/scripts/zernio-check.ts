import { listZernioAccounts } from "../src/zernio";

console.log(JSON.stringify(await listZernioAccounts(), null, 2));
