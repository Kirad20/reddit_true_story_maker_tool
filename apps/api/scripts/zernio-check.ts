import { connectedAccounts, refreshAccounts } from "../src/zernio";

await refreshAccounts(true);
console.log(JSON.stringify(connectedAccounts(), null, 2));
