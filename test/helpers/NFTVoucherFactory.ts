import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import ethers, { BigNumber, BigNumberish, BytesLike, Wallet } from "ethers";

// These constants must match the ones used in the smart contract.
const SIGNING_DOMAIN_NAME = "LegitArtERC721";
const SIGNING_DOMAIN_VERSION = "1";

// EIP-712 Typed Data
// See: https://eips.ethereum.org/EIPS/eip-712
export interface TypedDataDomain {
  name?: string;
  version?: string;
  chainId?: BigNumberish;
  verifyingContract?: string;
  salt?: BytesLike;
}

export type NFTVoucher = {
  tokenId: BigNumberish;
  price: BigNumberish;
  uri: string;
  createdAt: BigNumberish;
  signature: BytesLike;
};

export class NFTVoucherFactory {
  contract: ethers.Contract;
  signer: Wallet | SignerWithAddress;
  _domain?: TypedDataDomain;

  constructor({ contract, signer }: { contract: ethers.Contract; signer: Wallet | SignerWithAddress }) {
    this.contract = contract;
    this.signer = signer;
  }

  // TODO: Use param as obj.
  async createVoucher(tokenId: number, uri: string, price: BigNumberish): Promise<NFTVoucher> {
    const createdAt = BigNumber.from(Math.round(Date.now() / 1000).toString()); // Get current timestamp in secs
    const voucher = { tokenId, price, uri, createdAt };
    const domain = await this._signingDomain();
    const types = {
      NFTVoucher: [
        { name: "tokenId", type: "uint256" },
        { name: "price", type: "uint256" },
        { name: "uri", type: "string" },
        { name: "createdAt", type: "uint256" },
      ],
    };
    const signature = await this.signer._signTypedData(domain, types, voucher);
    return {
      ...voucher,
      signature,
    };
  }

  async _signingDomain() {
    if (this._domain != null) {
      return this._domain;
    }
    const { chainId } = await this.contract.provider.getNetwork();
    this._domain = {
      name: SIGNING_DOMAIN_NAME,
      version: SIGNING_DOMAIN_VERSION,
      verifyingContract: this.contract.address,
      chainId,
    };
    return this._domain;
  }
}
