Web3Storage plugin for ts-odd.

## Usage

```ts
import * as odd from "@oddjs/odd"
import * as web3storage from "odd-web3storage"

const config = { namespace: "example", debug: true }
const components = await web3storage.components(config)
const program = await odd.program(config, components)
```

If you'd rather choose individual components instead:

```ts
import * as account from "odd-web3storage/components/account"
import * as clerk from "odd-web3storage/components/clerk"
import * as depot from "odd-web3storage/components/depot"

const components = {
  clerk: clerk.implementation()
}
```
