import { keccak256, toUtf8Bytes } from "ethers/lib/utils";

export const MINTER_ROLE = keccak256(toUtf8Bytes("MINTER_ROLE"));

export const Address = {
  mainnet: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    FEE_BENEFICIARY: "0x0000000000000000000000000000000000000000",
  },
  goerli: {
    USDC: "0x07865c6e87b9f70255377e024ace6630c1eaa37f",
    FEE_BENEFICIARY: "0x275764a36958ED545D7E8Ca39D75BC4A83c9c82d",
  },
};
